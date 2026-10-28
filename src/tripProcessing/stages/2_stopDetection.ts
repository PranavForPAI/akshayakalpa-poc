import RBush from 'rbush';
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { point as turfPoint } from '@turf/helpers';
import { haversineDistanceM, pathLengthM } from '../geo/geodesic.js';
import type { TripContext, RawPoint, Stop, PremiseGeofenceData } from '../types.js';

interface BBoxItem {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  geofence: PremiseGeofenceData;
}

/**
 * Calculates weighted median for 1D coordinates with weights.
 */
function weightedMedian(values: number[], weights: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];

  const indexed = values.map((val, idx) => ({ val, weight: weights[idx] }));
  indexed.sort((a, b) => a.val - b.val);

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  let cumulative = 0;
  for (const item of indexed) {
    cumulative += item.weight;
    if (cumulative >= totalWeight / 2) {
      return item.val;
    }
  }
  return indexed[indexed.length - 1].val;
}

/**
 * Computes accuracy-weighted anchor [lat, lon] for a set of raw points.
 */
function computeAnchor(points: RawPoint[]): { lat: number; lon: number; maxRadiusM: number } {
  const lats = points.map((p) => p.latitude);
  const lons = points.map((p) => p.longitude);
  const weights = points.map((p) => 1.0 / Math.max(p.accuracyMeters ?? 10.0, 1.0));

  const anchorLat = weightedMedian(lats, weights);
  const anchorLon = weightedMedian(lons, weights);

  let maxRadiusM = 0;
  for (const p of points) {
    const d = haversineDistanceM(anchorLat, anchorLon, p.latitude, p.longitude);
    if (d > maxRadiusM) maxRadiusM = d;
  }

  return { lat: anchorLat, lon: anchorLon, maxRadiusM };
}

function getMedian(numbers: number[]): number {
  if (numbers.length === 0) return 0;
  const sorted = [...numbers].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Stage 2: Stop Detection
 * - Identifies stationary jitter episodes using a 60s rolling window.
 * - Identifies premise geofence stays using RBush spatial index and point-in-polygon.
 * - Extracts discrete Stop episodes (anchor, arrivalTs, departureTs, dwellS, absorbed points).
 * - Excludes absorbed points from Kalman smoothing and moving distance.
 */
export function stopDetectionStage(ctx: TripContext): TripContext {
  const points = ctx.filteredPoints ?? [];
  const { config, premiseGeofences } = ctx;

  if (points.length === 0) {
    ctx.stops = [];
    ctx.absorbedPointIds = new Set();
    return ctx;
  }

  // Build RBush spatial index for premise geofences if present
  let geofenceIndex: RBush<BBoxItem> | null = null;
  if (premiseGeofences && premiseGeofences.length > 0) {
    geofenceIndex = new RBush<BBoxItem>();
    const items: BBoxItem[] = premiseGeofences.map((g) => ({
      minX: g.minLon,
      minY: g.minLat,
      maxX: g.maxLon,
      maxY: g.maxLat,
      geofence: g,
    }));
    geofenceIndex.load(items);
  }

  const isInsideGeofence = (p: RawPoint): boolean => {
    if (!geofenceIndex) return false;
    const candidates = geofenceIndex.search({
      minX: p.longitude,
      minY: p.latitude,
      maxX: p.longitude,
      maxY: p.latitude,
    });
    if (candidates.length === 0) return false;

    const pt = turfPoint([p.longitude, p.latitude]);
    for (const cand of candidates) {
      if (booleanPointInPolygon(pt, cand.geofence.polygon)) {
        return true;
      }
    }
    return false;
  };

  const stops: Stop[] = [];
  const absorbedIds = new Set<number>();
  const ROLLING_WINDOW_S = 60;

  let i = 0;
  const n = points.length;

  while (i < n) {
    // Check if points[i] is inside a premise geofence
    if (isInsideGeofence(points[i])) {
      const startIdx = i;
      let endIdx = i;
      while (endIdx < n && isInsideGeofence(points[endIdx])) {
        endIdx++;
      }
      const geofencePoints = points.slice(startIdx, endIdx);
      const dwellS =
        (geofencePoints[geofencePoints.length - 1].deviceTime.getTime() -
          geofencePoints[0].deviceTime.getTime()) /
        1000;

      if (dwellS >= config.stopMinDwellS || geofencePoints.length >= 3) {
        const { lat, lon, maxRadiusM } = computeAnchor(geofencePoints);
        const pointIds: number[] = [];
        for (const p of geofencePoints) {
          if (p.id !== undefined) {
            pointIds.push(p.id);
            absorbedIds.add(p.id);
          }
        }
        stops.push({
          anchorLat: lat,
          anchorLon: lon,
          arrivalTs: geofencePoints[0].deviceTime,
          departureTs: geofencePoints[geofencePoints.length - 1].deviceTime,
          dwellS,
          nPoints: geofencePoints.length,
          radiusM: maxRadiusM,
          reason: 'geofence',
          absorbedRawIds: pointIds,
        });
        i = endIdx;
        continue;
      }
    }

    // Check for stationary jitter in rolling window starting at index i
    let windowEnd = i;
    const startTs = points[i].deviceTime.getTime();
    while (
      windowEnd < n &&
      points[windowEnd].deviceTime.getTime() - startTs <= ROLLING_WINDOW_S * 1000
    ) {
      windowEnd++;
    }

    const windowPoints = points.slice(i, windowEnd);
    if (windowPoints.length < 2) {
      i++;
      continue;
    }

    const netDispM = haversineDistanceM(
      windowPoints[0].latitude,
      windowPoints[0].longitude,
      windowPoints[windowPoints.length - 1].latitude,
      windowPoints[windowPoints.length - 1].longitude
    );
    const pathLenM = pathLengthM(windowPoints);
    const accuracies = windowPoints.map((p) => p.accuracyMeters ?? 10.0);
    const medAccuracy = getMedian(accuracies);
    const speeds = windowPoints.map((p) => p.speedMps ?? 0);
    const medSpeed = getMedian(speeds);

    const tortuosity = netDispM > 0.05 ? pathLenM / netDispM : 999.0;
    const displacementLimit = Math.max(config.stopRadiusM, 2 * medAccuracy);

    const isJitter =
      netDispM < displacementLimit &&
      (tortuosity > config.tortuosityMin || medSpeed < config.stopSpeedMps);

    if (!isJitter) {
      i++;
      continue;
    }

    // Jitter detected! Grow the stop episode until exit hysteresis conditions are met
    const stopPoints: RawPoint[] = [...windowPoints];
    let anchor = computeAnchor(stopPoints);
    let currIdx = windowEnd;
    let consecutiveExitCount = 0;

    while (currIdx < n) {
      const candidate = points[currIdx];
      const distFromAnchor = haversineDistanceM(
        anchor.lat,
        anchor.lon,
        candidate.latitude,
        candidate.longitude
      );
      const candSpeed = candidate.speedMps ?? 0;

      // Hysteresis exit: distance > exitRadiusM for >= 3 consecutive fixes with speed > exitSpeedMps
      if (distFromAnchor > config.exitRadiusM && candSpeed > config.exitSpeedMps) {
        consecutiveExitCount++;
        if (consecutiveExitCount >= 3) {
          // Exit confirmed; back up 2 points that were part of the exit movement
          stopPoints.splice(stopPoints.length - (consecutiveExitCount - 1));
          break;
        }
      } else {
        consecutiveExitCount = 0;
      }

      stopPoints.push(candidate);
      anchor = computeAnchor(stopPoints);
      currIdx++;
    }

    const dwellS =
      (stopPoints[stopPoints.length - 1].deviceTime.getTime() -
        stopPoints[0].deviceTime.getTime()) /
      1000;

    // Must satisfy minimum dwell time to qualify as a Stop
    if (dwellS >= config.stopMinDwellS) {
      const finalAnchor = computeAnchor(stopPoints);
      const pointIds: number[] = [];
      for (const p of stopPoints) {
        if (p.id !== undefined) {
          pointIds.push(p.id);
          absorbedIds.add(p.id);
        }
      }

      stops.push({
        anchorLat: finalAnchor.lat,
        anchorLon: finalAnchor.lon,
        arrivalTs: stopPoints[0].deviceTime,
        departureTs: stopPoints[stopPoints.length - 1].deviceTime,
        dwellS,
        nPoints: stopPoints.length,
        radiusM: finalAnchor.maxRadiusM,
        reason: 'jitter',
        absorbedRawIds: pointIds,
      });

      i = currIdx;
    } else {
      i++;
    }
  }

  ctx.stops = stops;
  ctx.absorbedPointIds = absorbedIds;
  return ctx;
}
