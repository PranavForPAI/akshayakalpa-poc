import http from 'node:http';
import type { AddressInfo } from 'node:net';
import polyline from '@mapbox/polyline';
import { haversineDistanceM } from '../../../src/tripProcessing/geo/geodesic.js';

export interface CapturedMatchRequest {
  /** Path prefix identifying the region, e.g. 'A' for http://host/A */
  region: string;
  profile: string;
  coords: Array<[number, number]>; // [lon, lat]
  timestamps: number[];
  radiuses: number[];
  params: URLSearchParams;
  encoding: 'plain' | 'polyline6';
}

export interface StubReply {
  status?: number;
  body?: unknown;
  delayMs?: number;
}

export type MatchHandler = (req: CapturedMatchRequest) => StubReply;

/**
 * Tiny local OSRM stub. URLs look like http://127.0.0.1:PORT/<region>/match/v1/<profile>/<coords>.
 * Default /match behaviour echoes the input as a perfect match (geometry = input coordinates).
 */
export class OsrmStub {
  readonly matchRequests: CapturedMatchRequest[] = [];
  readonly nearestRequests: string[] = [];
  matchHandlers = new Map<string, MatchHandler>();
  nearestStatus = new Map<string, number>();
  private server!: http.Server;
  baseUrl = '';

  async start(): Promise<void> {
    this.server = http.createServer((req, res) => this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', () => r()));
    const { port } = this.server.address() as AddressInfo;
    this.baseUrl = `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections?.();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  reset(): void {
    this.matchRequests.length = 0;
    this.nearestRequests.length = 0;
    this.matchHandlers.clear();
    this.nearestStatus.clear();
  }

  urlFor(region: string): string {
    return `${this.baseUrl}/${region}`;
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', this.baseUrl);
    const parts = url.pathname.split('/').filter(Boolean); // [region, service, v1, profile, coords]
    const [region, service, , profile, rawCoords] = parts;
    const send = (status: number, body: unknown, delayMs = 0) => {
      const t = setTimeout(() => {
        if (res.writableEnded || res.destroyed) return;
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
      }, delayMs);
      res.on('close', () => clearTimeout(t));
    };

    if (service === 'nearest') {
      this.nearestRequests.push(region);
      const status = this.nearestStatus.get(region) ?? 200;
      if (status !== 200) return send(status, { code: 'Error' });
      return send(200, { code: 'Ok', waypoints: [{ location: [0, 0], distance: 1 }] });
    }
    if (service !== 'match') return send(400, { code: 'InvalidService' });

    const decoded = decodeURIComponent(rawCoords);
    let coords: Array<[number, number]>;
    let encoding: 'plain' | 'polyline6' = 'plain';
    if (decoded.startsWith('polyline6(')) {
      encoding = 'polyline6';
      coords = polyline.decode(decoded.slice('polyline6('.length, -1), 6).map(([lat, lon]) => [lon, lat]);
    } else {
      coords = decoded.split(';').map((c) => c.split(',').map(Number) as [number, number]);
    }
    const captured: CapturedMatchRequest = {
      region,
      profile,
      coords,
      timestamps: (url.searchParams.get('timestamps') ?? '').split(';').map(Number),
      radiuses: (url.searchParams.get('radiuses') ?? '').split(';').map(Number),
      params: url.searchParams,
      encoding,
    };
    this.matchRequests.push(captured);
    const handler = this.matchHandlers.get(region) ?? this.matchHandlers.get('*') ?? echoMatch();
    const reply = handler(captured);
    send(reply.status ?? 200, reply.body, reply.delayMs ?? 0);
  }
}

function lengthOf(coords: Array<[number, number]>): number[] {
  const legs: number[] = [];
  for (let i = 1; i < coords.length; i++) {
    legs.push(haversineDistanceM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return legs;
}

/**
 * Perfect match: geometry = (optionally transformed) input; tracepoints at (optionally shifted)
 * input locations; one sub-matching.
 */
export function echoMatch(
  opts: {
    confidence?: number;
    /** shift applied to geometry and tracepoints (degrees lat) */
    shiftLat?: number;
    /** add a lateral zig-zag vertex of this many degrees between input points (inflates length) */
    zigzagDeg?: number;
  } = {}
): MatchHandler {
  return (req) => {
    const shifted = req.coords.map(([lon, lat]) => [lon, lat + (opts.shiftLat ?? 0)] as [number, number]);
    const geometry: Array<[number, number]> = [];
    const legs: number[] = [];
    for (let i = 0; i < shifted.length; i++) {
      if (i > 0 && opts.zigzagDeg) {
        const [lon0, lat0] = shifted[i - 1];
        const [lon1, lat1] = shifted[i];
        const mid: [number, number] = [(lon0 + lon1) / 2, (lat0 + lat1) / 2 + (i % 2 ? 1 : -1) * opts.zigzagDeg];
        const d = lengthOf([shifted[i - 1], mid, shifted[i]]).reduce((a, b) => a + b, 0);
        geometry.push(mid);
        legs.push(d);
      } else if (i > 0) {
        legs.push(lengthOf([shifted[i - 1], shifted[i]])[0]);
      }
      geometry.push(shifted[i]);
    }
    return {
      body: {
        code: 'Ok',
        matchings: [
          {
            confidence: opts.confidence ?? 0.9,
            distance: legs.reduce((a, b) => a + b, 0),
            duration: 1,
            geometry: { type: 'LineString', coordinates: geometry },
            legs: legs.map((d) => ({ distance: d, duration: 1 })),
          },
        ],
        tracepoints: shifted.map((loc, k) => ({
          location: loc,
          matchings_index: 0,
          waypoint_index: k,
          alternatives_count: 0,
          distance: 0,
        })),
      },
    };
  };
}

/** Axis-aligned rectangle as a GeoJSON Polygon. */
export function rect(minLon: number, minLat: number, maxLon: number, maxLat: number) {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  };
}
