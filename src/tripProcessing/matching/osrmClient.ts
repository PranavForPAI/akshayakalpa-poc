import polyline from '@mapbox/polyline';
import type { OsrmRegionalConfig } from '../config.js';
import type { OsrmRegion } from './regionRegistry.js';
import { fetchWithTimeout, withRetry } from './retry.js';
import { headingDiffDeg, headingFromVelocityDeg, type LonLat } from './geoUtils.js';

/**
 * OSRM HTTP client for the Map Matching service.
 *
 * Pinned API: OSRM backend HTTP API v5 (`/match/v1/...`), checked against the
 * osrm-backend v5.24.0 API docs (http://project-osrm.org/docs/v5.24.0/api/). Exercised locally
 * against ghcr.io/project-osrm/osrm-backend v26.10.0, which serves the same /match/v1 format.
 *  - osrm-routed ignores the {profile} URL segment (the loaded dataset decides); we still send
 *    the region's profile name so logs and provenance stay meaningful.
 *  - osrm-routed only serves GET; there is no POST body variant. Long traces therefore switch
 *    coordinates to `polyline6(...)` encoding (supported since 5.x) when the URL would exceed
 *    `maxUrlLength`. `timestamps` / `radiuses` remain `;`-separated query params.
 *  - `timestamps` are integer UNIX seconds and must be monotonically increasing; we enforce
 *    strictly increasing values (bump equal seconds by +1 s).
 *  - The number of coordinates must be <= the server's `--max-matching-size` (default 100);
 *    `maxPointsPerRequest` (default 90) must be configured below it.
 *  - Errors are HTTP 400 with `code` in {NoMatch, NoSegment, TooBig, InvalidQuery, ...}.
 *
 * This client NEVER throws: every failure is returned as `{ ok: false, reason }`.
 */

export interface MatchInputPoint {
  /** Index of the point within the moving chunk (for mapping results back) */
  index: number;
  lon: number;
  lat: number;
  tsSec: number;
  radiusM: number;
}

export interface OsrmTracepoint {
  location: LonLat;
  matchings_index: number;
  waypoint_index: number;
  distance?: number;
  alternatives_count?: number;
}

export interface OsrmMatching {
  confidence: number;
  distance: number;
  duration: number;
  geometry: { type: 'LineString'; coordinates: LonLat[] };
  legs: Array<{ distance: number; duration: number }>;
}

export type MatchFailureReason =
  | 'no_match'
  | 'no_segment'
  | 'too_big'
  | 'timeout'
  | 'http_5xx'
  | 'http_error'
  | 'network_error'
  | 'invalid_response'
  | 'too_few_points'
  | `osrm_${string}`;

export type MatchResponse =
  | { ok: true; matchings: OsrmMatching[]; tracepoints: Array<OsrmTracepoint | null>; httpMs: number; encoding: 'plain' | 'polyline6' }
  | { ok: false; reason: MatchFailureReason; httpMs: number; transient: boolean; detail?: string };

const TRANSIENT: ReadonlySet<string> = new Set(['timeout', 'http_5xx', 'network_error']);

export type OsrmClientConfig = Pick<
  OsrmRegionalConfig,
  'maxUrlLength' | 'requestTimeoutMs' | 'retries' | 'retryBaseDelayMs' | 'maxPointsPerRequest'
>;

export class OsrmClient {
  constructor(private readonly cfg: OsrmClientConfig) {}

  buildMatchUrl(region: Pick<OsrmRegion, 'osrmUrl' | 'profile'>, points: MatchInputPoint[]): { url: string; encoding: 'plain' | 'polyline6' } {
    const base = `${region.osrmUrl.replace(/\/+$/, '')}/match/v1/${encodeURIComponent(region.profile)}/`;
    const ts: number[] = [];
    for (const p of points) {
      const t = Math.floor(p.tsSec);
      ts.push(ts.length > 0 && t <= ts[ts.length - 1] ? ts[ts.length - 1] + 1 : t);
    }
    const query =
      '?geometries=geojson&overview=full&annotations=false&gaps=ignore&tidy=true&steps=false' +
      `&timestamps=${ts.join(';')}` +
      `&radiuses=${points.map((p) => p.radiusM.toFixed(1)).join(';')}`;

    const plain = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
    const plainUrl = base + plain + query;
    if (plainUrl.length <= this.cfg.maxUrlLength) return { url: plainUrl, encoding: 'plain' };

    const encoded = polyline.encode(points.map((p) => [p.lat, p.lon]), 6);
    return { url: `${base}polyline6(${encodeURIComponent(encoded)})${query}`, encoding: 'polyline6' };
  }

  async match(region: Pick<OsrmRegion, 'osrmUrl' | 'profile'>, points: MatchInputPoint[]): Promise<MatchResponse> {
    if (points.length < 2) return { ok: false, reason: 'too_few_points', httpMs: 0, transient: false };
    if (points.length > this.cfg.maxPointsPerRequest) {
      return { ok: false, reason: 'too_big', httpMs: 0, transient: false, detail: 'exceeds maxPointsPerRequest' };
    }
    const { url, encoding } = this.buildMatchUrl(region, points);
    let totalMs = 0;
    const res = await withRetry(
      async () => {
        const r = await this.once(url, encoding);
        totalMs += r.httpMs;
        return r;
      },
      {
        retries: this.cfg.retries,
        baseDelayMs: this.cfg.retryBaseDelayMs,
        shouldRetry: (r) => !(r as MatchResponse).ok && (r as any).transient,
      }
    );
    return { ...res, httpMs: totalMs };
  }

  private async once(url: string, encoding: 'plain' | 'polyline6'): Promise<MatchResponse> {
    const t0 = Date.now();
    const elapsed = () => Date.now() - t0;
    let resp: Response;
    try {
      resp = await fetchWithTimeout(url, this.cfg.requestTimeoutMs, { headers: { accept: 'application/json' } });
    } catch (err: any) {
      const reason = err?.name === 'TimeoutError' ? 'timeout' : 'network_error';
      return { ok: false, reason, httpMs: elapsed(), transient: true, detail: err?.message };
    }
    if (resp.status >= 500) {
      await resp.body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'http_5xx', httpMs: elapsed(), transient: true, detail: `HTTP ${resp.status}` };
    }
    let body: any;
    try {
      body = await resp.json();
    } catch {
      return { ok: false, reason: resp.ok ? 'invalid_response' : 'http_error', httpMs: elapsed(), transient: false, detail: `HTTP ${resp.status}` };
    }
    const code: string | undefined = body?.code;
    if (code === 'Ok' && Array.isArray(body.matchings) && Array.isArray(body.tracepoints)) {
      return { ok: true, matchings: body.matchings, tracepoints: body.tracepoints, httpMs: elapsed(), encoding };
    }
    if (code === 'NoMatch') return { ok: false, reason: 'no_match', httpMs: elapsed(), transient: false };
    if (code === 'NoSegment') return { ok: false, reason: 'no_segment', httpMs: elapsed(), transient: false };
    if (code === 'TooBig') return { ok: false, reason: 'too_big', httpMs: elapsed(), transient: false };
    if (code) return { ok: false, reason: `osrm_${code}`, httpMs: elapsed(), transient: false, detail: body?.message };
    return { ok: false, reason: resp.ok ? 'invalid_response' : 'http_error', httpMs: elapsed(), transient: false, detail: `HTTP ${resp.status}` };
  }
}

export interface DownsampleablePoint {
  tsSec: number;
  vx: number;
  vy: number;
  speedMps: number;
}

/**
 * Downsamples to roughly one point per `intervalS`, always keeping:
 *  - the first and last point,
 *  - `forced` indices (run / window boundaries used for cutting),
 *  - turning points: heading change vs the last kept point above `turnAngleDeg`
 *    (heading from the smoothed velocity; ignored below 1 m/s where heading is noise).
 * `indices` are positions into `points` and must be ascending.
 */
export function downsampleIndices(
  points: DownsampleablePoint[],
  indices: number[],
  intervalS: number,
  turnAngleDeg: number,
  forced: ReadonlySet<number> = new Set()
): number[] {
  if (indices.length <= 2) return [...indices];
  const out: number[] = [indices[0]];
  const headingOf = (i: number) =>
    points[i].speedMps >= 1 ? headingFromVelocityDeg(points[i].vx, points[i].vy) : null;
  let lastHeading = headingOf(indices[0]);
  for (let k = 1; k < indices.length - 1; k++) {
    const i = indices[k];
    const last = out[out.length - 1];
    const h = headingOf(i);
    const turned = h !== null && lastHeading !== null && headingDiffDeg(h, lastHeading) > turnAngleDeg;
    if (forced.has(i) || turned || points[i].tsSec - points[last].tsSec >= intervalS) {
      out.push(i);
      if (h !== null) lastHeading = h;
    }
  }
  out.push(indices[indices.length - 1]);
  return out;
}

export function clampRadius(sigmaM: number, minM: number, maxM: number): number {
  if (!Number.isFinite(sigmaM)) return maxM;
  return Math.min(maxM, Math.max(minM, sigmaM));
}

export function isTransientReason(reason: string): boolean {
  return TRANSIENT.has(reason);
}
