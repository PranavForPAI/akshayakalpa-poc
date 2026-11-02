import crypto from 'node:crypto';
import { haversineDistanceM, simplifyCoordinates, encodePolyline } from '../geo/geodesic.js';
import type { TripContext, DistanceSummary, Segment, MatchedSegment } from '../types.js';
import { effectiveConfigForHash } from '../config.js';

/**
 * Computes geodesic distance of a segment in meters.
 * Moving segments: cumulative haversine length between sequential coordinates.
 * Connector segments: distance between start and end coordinate.
 * Stops: 0 meters.
 */
export function computeSegmentDistanceM(coords: [number, number][] | [number, number], type: string): number {
  if (type === 'stop') {
    return 0;
  }
  if (!Array.isArray(coords) || coords.length === 0) {
    return 0;
  }

  // Connector is a 2-point array [[lon1, lat1], [lon2, lat2]]
  // Moving is an N-point array [[lon1, lat1], [lon2, lat2], ...]
  if (Array.isArray(coords[0])) {
    const coordList = coords as [number, number][];
    let dist = 0;
    for (let i = 1; i < coordList.length; i++) {
      dist += haversineDistanceM(
        coordList[i - 1][1], // lat
        coordList[i - 1][0], // lon
        coordList[i][1],
        coordList[i][0]
      );
    }
    return dist;
  }

  return 0;
}

/**
 * Final trip distance given (optional) matcher output.
 * - Segments without matcher pieces (connectors, stops, unhandled moving chunks) keep their
 *   smoothed length via computeSegmentDistanceM.
 * - A moving segment with pieces contributes the sum of its pieces (matched: matchedLengthM;
 *   unmatched: smoothed geometry length) plus the straight join between consecutive pieces
 *   (0 when the stitcher connected them).
 */
export function computeFinalDistanceM(
  segments: Segment[],
  matchedSegments: MatchedSegment[] = []
): number {
  const piecesByChunk = new Map<number, MatchedSegment[]>();
  for (const m of matchedSegments) {
    if (m.chunkIndex === undefined) continue;
    let list = piecesByChunk.get(m.chunkIndex);
    if (!list) piecesByChunk.set(m.chunkIndex, (list = []));
    list.push(m);
  }

  let total = 0;
  for (const seg of segments) {
    const pieces =
      seg.segmentType === 'moving' && seg.chunkIndex !== undefined
        ? piecesByChunk.get(seg.chunkIndex)
        : undefined;
    if (!pieces || pieces.length === 0) {
      total += computeSegmentDistanceM(seg.coordinates, seg.segmentType);
      continue;
    }
    let prevLast: [number, number] | null = null;
    for (const p of pieces) {
      total +=
        p.segmentType === 'matched' && p.matchedLengthM != null
          ? p.matchedLengthM
          : computeSegmentDistanceM(p.coordinates, 'moving');
      if (prevLast && p.coordinates.length > 0) {
        const first = p.coordinates[0];
        total += haversineDistanceM(prevLast[1], prevLast[0], first[1], first[0]);
      }
      if (p.coordinates.length > 0) prevLast = p.coordinates[p.coordinates.length - 1];
    }
  }
  return total;
}

/**
 * Stage 5: Distance Calculation and Diagnostics
 */
export function distanceStage(ctx: TripContext): TripContext {
  const { config, segments = [], rawPoints = [], filteredPoints = [], smoothedPoints = [] } = ctx;

  // 1. Calculate smoothed distance: moving chunks + connectors (stops add zero)
  let distanceSmoothedM = 0;
  for (const seg of segments) {
    distanceSmoothedM += computeSegmentDistanceM(seg.coordinates, seg.segmentType);
  }

  // 2. Calculate raw filtered distance (geodesic distance of preprocessed raw points)
  let distanceRawFilteredM = 0;
  for (let i = 1; i < filteredPoints.length; i++) {
    distanceRawFilteredM += haversineDistanceM(
      filteredPoints[i - 1].latitude,
      filteredPoints[i - 1].longitude,
      filteredPoints[i].latitude,
      filteredPoints[i].longitude
    );
  }

  // 3. Calculate Doppler distance: sum of (speed x dt) across smoothed moving points
  let distanceDopplerM = 0;
  for (let i = 1; i < smoothedPoints.length; i++) {
    const prev = smoothedPoints[i - 1];
    const curr = smoothedPoints[i];
    const dtSec = (curr.deviceTime.getTime() - prev.deviceTime.getTime()) / 1000;
    if (dtSec > 0 && dtSec <= config.gapSplitS) {
      const avgSpeed = (curr.speedMps + prev.speedMps) / 2;
      distanceDopplerM += avgSpeed * dtSec;
    }
  }

  // 4. Odometer distance: (odometer_end - odometer_start) converted from km to meters
  let distanceOdometerM: number | null = null;
  let errorOdometerPct: number | null = null;
  let errorRawVsOdometerPct: number | null = null;

  if (
    ctx.odometerStartKm !== null &&
    ctx.odometerStartKm !== undefined &&
    ctx.odometerEndKm !== null &&
    ctx.odometerEndKm !== undefined
  ) {
    const diffKm = ctx.odometerEndKm - ctx.odometerStartKm;
    if (diffKm > 0) {
      distanceOdometerM = diffKm * 1000;
      // Absolute error % vs odometer
      errorOdometerPct =
        (Math.abs(distanceSmoothedM - distanceOdometerM) / distanceOdometerM) * 100;
      errorRawVsOdometerPct =
        (Math.abs(distanceRawFilteredM - distanceOdometerM) / distanceOdometerM) * 100;
    }
  }

  // 5. Evaluate Map Matching Trigger
  let triggerReason: string | null = null;
  const distanceSmoothedKm = distanceSmoothedM / 1000;

  if (config.mapMatching.enabled) {
    if (distanceOdometerM === null) {
      triggerReason = 'NO_ODOMETER_AVAILABLE';
    } else if (distanceSmoothedKm <= config.mmMinKm) {
      triggerReason = `DISTANCE_BELOW_MIN_KM_${config.mmMinKm}`;
    } else if (errorOdometerPct !== null && errorOdometerPct > config.mmTriggerPct) {
      triggerReason = `ODOMETER_DISCREPANCY_${errorOdometerPct.toFixed(2)}_PCT_GT_${config.mmTriggerPct}_PCT`;
    } else {
      triggerReason = 'ACCURACY_WITHIN_TOLERANCE';
    }
  }

  // Final distance defaults to smoothed distance (updated if matched segments exist)
  const distanceFinalM = distanceSmoothedM;

  // 6. Generate simplified polyline for display (never used for distance)
  let simplifiedPolyline: string | null = null;
  const displayCoords: [number, number][] = [];
  for (const seg of segments) {
    if (seg.segmentType === 'stop') {
      const pt = seg.coordinates as [number, number];
      displayCoords.push([pt[1], pt[0]]); // [lat, lon]
    } else if (Array.isArray(seg.coordinates[0])) {
      for (const c of seg.coordinates as [number, number][]) {
        displayCoords.push([c[1], c[0]]); // [lat, lon]
      }
    }
  }

  if (displayCoords.length > 0) {
    const simplified = simplifyCoordinates(displayCoords, 10.0);
    simplifiedPolyline = encodePolyline(simplified);
  }

  // 7. Diagnostics counts & params hash
  const nRaw = rawPoints.length;
  const nRejected = smoothedPoints.filter((p) => p.flags.includes('rejected')).length;
  const nStopPoints = ctx.absorbedPointIds ? ctx.absorbedPointIds.size : 0;
  const nChunks = ctx.chunks ? ctx.chunks.length : 0;

  const configJson = JSON.stringify(effectiveConfigForHash(config));
  const paramsHash = crypto.createHash('md5').update(configJson).digest('hex');

  const summary: DistanceSummary = {
    distanceFinalM: Math.round(distanceFinalM * 100) / 100,
    distanceSmoothedM: Math.round(distanceSmoothedM * 100) / 100,
    distanceRawFilteredM: Math.round(distanceRawFilteredM * 100) / 100,
    distanceDopplerM: Math.round(distanceDopplerM * 100) / 100,
    distanceOdometerM: distanceOdometerM ? Math.round(distanceOdometerM * 100) / 100 : null,
    errorOdometerPct: errorOdometerPct ? Math.round(errorOdometerPct * 100) / 100 : null,
    errorRawVsOdometerPct: errorRawVsOdometerPct
      ? Math.round(errorRawVsOdometerPct * 100) / 100
      : null,
    nRaw,
    nRejected,
    nStopPoints,
    nChunks,
    triggerReason,
    paramsHash,
    simplifiedPolyline,
    processedAt: new Date(),
    pipelineVersion: config.pipelineVersion,
  };

  ctx.distances = summary;
  ctx.diagnostics = {
    nRaw,
    nFiltered: filteredPoints.length,
    nRejected,
    nStopPoints,
    nChunks,
    triggerReason,
    paramsHash,
  };

  return ctx;
}
