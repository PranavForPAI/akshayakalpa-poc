import type { RawPoint } from '../../../src/tripProcessing/types.js';

const M_PER_DEG_LAT = 111_320;

/**
 * Deterministic synthetic trace: drive east, dwell (stop), drive north.
 * Used by the matcher tests and by the "matching disabled is unchanged" golden fixture.
 */
export function buildStopAndGoTrace(
  startLat = 12.9716,
  startLon = 77.5946,
  baseIso = '2026-03-01T06:00:00Z'
): RawPoint[] {
  const base = new Date(baseIso).getTime();
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((startLat * Math.PI) / 180);
  const pts: RawPoint[] = [];
  let id = 1;
  let t = 0;
  let lat = startLat;
  let lon = startLon;
  // deterministic pseudo-noise
  let seed = 42;
  const noise = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed / 2147483647 - 0.5) * 2; // [-1, 1]
  };
  const push = (speed: number, heading: number) => {
    pts.push({
      id: id++,
      latitude: lat + (noise() * 2) / M_PER_DEG_LAT,
      longitude: lon + (noise() * 2) / mPerDegLon,
      deviceTime: new Date(base + t * 1000),
      accuracyMeters: 6,
      speedMps: speed,
      speedAccuracyMps: 0.5,
      headingDegrees: heading,
    });
  };

  // Leg 1: 120 s east at 10 m/s
  for (let i = 0; i < 120; i++) {
    push(10, 90);
    lon += 10 / mPerDegLon;
    t += 1;
  }
  // Stop: 180 s stationary jitter
  for (let i = 0; i < 180; i++) {
    push(0.2, 0);
    t += 1;
  }
  // Leg 2: 120 s north at 10 m/s
  for (let i = 0; i < 120; i++) {
    push(10, 0);
    lat += 10 / M_PER_DEG_LAT;
    t += 1;
  }
  return pts;
}

/** Straight eastward trace from (lat, lon) covering `seconds` at `speed` m/s, 1 Hz. */
export function buildStraightTrace(
  lat: number,
  lon: number,
  seconds: number,
  speed = 10,
  baseIso = '2026-03-01T08:00:00Z',
  headingDeg = 90
): RawPoint[] {
  const base = new Date(baseIso).getTime();
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
  const rad = (headingDeg * Math.PI) / 180;
  const pts: RawPoint[] = [];
  for (let i = 0; i < seconds; i++) {
    pts.push({
      id: i + 1,
      latitude: lat + (Math.cos(rad) * speed * i) / M_PER_DEG_LAT,
      longitude: lon + (Math.sin(rad) * speed * i) / mPerDegLon,
      deviceTime: new Date(base + i * 1000),
      accuracyMeters: 5,
      speedMps: speed,
      speedAccuracyMps: 0.5,
      headingDegrees: headingDeg,
    });
  }
  return pts;
}

/** Strips non-deterministic fields so pipeline outputs can be compared across runs/versions. */
export function canonicalPipelineOutput(ctx: any): any {
  const { processedAt, ...distances } = ctx.distances ?? {};
  return JSON.parse(
    JSON.stringify({
      distances,
      diagnostics: ctx.diagnostics,
      stops: ctx.stops,
      segments: (ctx.segments ?? []).map((s: any) => {
        // chunkIndex is an in-memory helper added with the matcher; not part of persisted output
        const { chunkIndex, ...rest } = s;
        return rest;
      }),
      smoothedPoints: ctx.smoothedPoints,
      matchedSegments: ctx.matchedSegments ?? null,
    })
  );
}
