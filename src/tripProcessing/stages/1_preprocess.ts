import { haversineDistanceM } from '../geo/geodesic.js';
import type { TripContext, RawPoint } from '../types.js';

/**
 * Stage 1: Preprocess raw GPS points.
 * - Sort chronologically by device timestamp.
 * - Drop duplicates and out-of-order fixes (ts <= prevTs).
 * - Drop mock locations (if isMock === true).
 * - Apply baseline filters: drop accuracy > maxAccuracyM (default 30m)
 *   and points with implied velocity > maxSpeedKph (default 100 km/h).
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

    // Drop duplicates and out-of-order timestamps
    if (lastAccepted) {
      const dtMs = point.deviceTime.getTime() - lastAccepted.deviceTime.getTime();
      if (dtMs <= 0) {
        continue;
      }

      // Check implied velocity between consecutive points (km/h)
      const distM = haversineDistanceM(
        lastAccepted.latitude,
        lastAccepted.longitude,
        point.latitude,
        point.longitude
      );
      const dtSec = dtMs / 1000;
      const impliedSpeedKph = (distM / dtSec) * 3.6;

      if (impliedSpeedKph > config.maxSpeedKph) {
        continue;
      }
    }

    // Filter by horizontal accuracy
    if (
      point.accuracyMeters !== null &&
      point.accuracyMeters !== undefined &&
      point.accuracyMeters > config.maxAccuracyM
    ) {
      continue;
    }

    filtered.push(point);
    lastAccepted = point;
  }

  ctx.filteredPoints = filtered;
  return ctx;
}
