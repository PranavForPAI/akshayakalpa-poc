import { haversineDistanceM } from '../geo/geodesic.js';
import type { TripContext, RawPoint } from '../types.js';

/**
 * Stage 1: Preprocess raw GPS points.
 * - Sort chronologically by device timestamp.
 * - Drop duplicates and out-of-order fixes (ts <= prevTs).
 * - Drop mock locations (if isMock === true).
 * - Low-accuracy fixes (accuracy > maxAccuracyM, default 30 m):
 *     'average' mode (default): consecutive low-accuracy fixes are replaced by ONE point at the
 *       average of their centres (one per lowAccuracyWindowS). The fix is kept, with its large
 *       accuracy, so the Kalman filter weights it lightly instead of the track getting a hole.
 *       Fixes worse than lowAccuracyMaxM are still dropped.
 *     'drop' mode: discard them.
 * - Drop points with implied velocity > maxSpeedKph (default 100 km/h).
 */
export function preprocessStage(ctx: TripContext): TripContext {
  const { rawPoints, config } = ctx;
  if (!rawPoints || rawPoints.length === 0) {
    ctx.filteredPoints = [];
    ctx.diagnostics = {
      nRaw: 0,
      nFiltered: 0,
      nRejected: 0,
      nStopPoints: 0,
      nChunks: 0,
      triggerReason: null,
      paramsHash: '',
    };
    return ctx;
  }

  // 1. Sort by device timestamp
  const sorted = [...rawPoints].sort(
    (a, b) => a.deviceTime.getTime() - b.deviceTime.getTime()
  );

  const filtered: RawPoint[] = [];
  let lastAccepted: RawPoint | null = null;
  const averaging = config.lowAccuracyMode === 'average';
  /** Pending run of consecutive low-accuracy fixes (average mode) */
  let lowRun: RawPoint[] = [];

  /** Dedupe + implied-speed checks against the last accepted point, then accept. */
  const accept = (point: RawPoint) => {
    if (lastAccepted) {
      const dtMs = point.deviceTime.getTime() - lastAccepted.deviceTime.getTime();
      if (dtMs <= 0) return;
      const distM = haversineDistanceM(
        lastAccepted.latitude,
        lastAccepted.longitude,
        point.latitude,
        point.longitude
      );
      const impliedSpeedKph = (distM / (dtMs / 1000)) * 3.6;
      if (impliedSpeedKph > config.maxSpeedKph) return;
    }
    filtered.push(point);
    lastAccepted = point;
  };

  const flushLowRun = () => {
    if (lowRun.length > 0) accept(averageFixes(lowRun));
    lowRun = [];
  };

  for (const point of sorted) {
    // Drop mock locations
    if (point.isMock) {
      continue;
    }

    // Drop invalid coordinates
    if (
      point.latitude < -90 ||
      point.latitude > 90 ||
      point.longitude < -180 ||
      point.longitude > 180 ||
      (point.latitude === 0 && point.longitude === 0)
    ) {
      continue;
    }

    const acc = point.accuracyMeters;
    const isLowAccuracy = acc !== null && acc !== undefined && acc > config.maxAccuracyM;

    if (isLowAccuracy) {
      if (!averaging || acc! > config.lowAccuracyMaxM) continue;
      // Duplicate / out-of-order vs the run or the last accepted point
      const last = lastAccepted as RawPoint | null;
      const prevTs = lowRun.length > 0 ? lowRun[lowRun.length - 1].deviceTime : last?.deviceTime;
      if (prevTs && point.deviceTime.getTime() <= prevTs.getTime()) continue;
      if (
        lowRun.length > 0 &&
        (point.deviceTime.getTime() - lowRun[0].deviceTime.getTime()) / 1000 > config.lowAccuracyWindowS
      ) {
        flushLowRun();
      }
      lowRun.push(point);
      continue;
    }

    flushLowRun();
    accept(point);
  }
  flushLowRun();

  ctx.filteredPoints = filtered;
  return ctx;
}

/**
 * Replaces a run of low-accuracy fixes with one point at the average of their centres.
 * Time is the mean time; accuracy is the mean accuracy (kept large on purpose, so the Kalman
 * filter trusts it little). Heading is cleared so the filter does a position-only update.
 */
function averageFixes(run: RawPoint[]): RawPoint {
  const n = run.length;
  const mean = (f: (p: RawPoint) => number) => run.reduce((acc, p) => acc + f(p), 0) / n;
  const tMean = mean((p) => p.deviceTime.getTime());
  // Representative raw id: the fix closest in time to the mean
  const rep = run.reduce((best, p) =>
    Math.abs(p.deviceTime.getTime() - tMean) < Math.abs(best.deviceTime.getTime() - tMean) ? p : best
  );
  const speeds = run.map((p) => p.speedMps).filter((v): v is number => v !== null && v !== undefined);
  return {
    id: rep.id,
    latitude: mean((p) => p.latitude),
    longitude: mean((p) => p.longitude),
    deviceTime: new Date(Math.round(tMean)),
    accuracyMeters: mean((p) => p.accuracyMeters ?? 0),
    speedMps: speeds.length > 0 ? speeds.reduce((a, b) => a + b, 0) / speeds.length : null,
    speedAccuracyMps: null,
    headingDegrees: null,
    isMock: false,
    averagedCount: n,
  };
}
