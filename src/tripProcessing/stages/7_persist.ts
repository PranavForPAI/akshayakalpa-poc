import prisma from '../../db/prisma.js';
import logger from '../../logger.js';
import type { TripContext } from '../types.js';

const CHUNK_SIZE = 1000;

/**
 * Stage 7: Persist Processed Output
 * Saves processed points, stops, segments, and distance summary.
 * Completely idempotent: executed in a single atomic database transaction.
 * Deletes any existing rows for (tripId, pipelineVersion) before inserting new ones.
 */
export async function persistStage(ctx: TripContext): Promise<TripContext> {
  const { tripId, config, smoothedPoints = [], stops = [], segments = [], distances } = ctx;
  const pipelineVersion = config.pipelineVersion;

  if (!distances) {
    logger.warn('persistStage: No distance summary to persist', { tripId });
    return ctx;
  }

  await prisma.$transaction(
    async (tx) => {
      // 1. Delete prior rows for this trip and pipeline_version
      await Promise.all([
        tx.tripProcessedPoint.deleteMany({
          where: { tripId, pipelineVersion },
        }),
        tx.tripStop.deleteMany({
          where: { tripId, pipelineVersion },
        }),
        tx.tripSegment.deleteMany({
          where: { tripId, pipelineVersion },
        }),
        tx.tripDistanceSummary.deleteMany({
          where: { tripId, pipelineVersion },
        }),
      ]);

      // 2. Insert processed points in chunks
      const pointRows = smoothedPoints.map((p) => ({
        tripId,
        rawPointId: p.rawPointId ?? null,
        lat: p.latitude,
        lon: p.longitude,
        ts: p.deviceTime,
        source: p.source,
        sigmaM: p.sigmaM,
        speedMps: p.speedMps,
        flags: p.flags,
        pipelineVersion,
      }));

      for (let i = 0; i < pointRows.length; i += CHUNK_SIZE) {
        const batch = pointRows.slice(i, i + CHUNK_SIZE);
        await tx.tripProcessedPoint.createMany({ data: batch });
      }

      // 3. Insert stops
      if (stops.length > 0) {
        const stopRows = stops.map((s) => ({
          tripId,
          anchorLat: s.anchorLat,
          anchorLon: s.anchorLon,
          arrivalTs: s.arrivalTs,
          departureTs: s.departureTs,
          dwellS: s.dwellS,
          nPoints: s.nPoints,
          radiusM: s.radiusM,
          reason: s.reason,
          absorbedRawIds: s.absorbedRawIds,
          pipelineVersion,
        }));
        await tx.tripStop.createMany({ data: stopRows });
      }

      // 4. Insert segments
      if (segments.length > 0) {
        const segmentRows = segments.map((seg) => ({
          tripId,
          segmentType: seg.segmentType,
          startTs: seg.startTs,
          endTs: seg.endTs,
          coordinates: seg.coordinates,
          source: seg.source,
          confidence: seg.confidence,
          dataVersion: seg.dataVersion ?? null,
          pipelineVersion,
        }));
        await tx.tripSegment.createMany({ data: segmentRows });
      }

      // 5. Insert distance summary
      await tx.tripDistanceSummary.create({
        data: {
          tripId,
          distanceFinalM: distances.distanceFinalM,
          distanceSmoothedM: distances.distanceSmoothedM,
          distanceRawFilteredM: distances.distanceRawFilteredM,
          distanceDopplerM: distances.distanceDopplerM,
          distanceOdometerM: distances.distanceOdometerM,
          errorOdometerPct: distances.errorOdometerPct,
          errorRawVsOdometerPct: distances.errorRawVsOdometerPct,
          nRaw: distances.nRaw,
          nRejected: distances.nRejected,
          nStopPoints: distances.nStopPoints,
          nChunks: distances.nChunks,
          triggerReason: distances.triggerReason,
          paramsHash: distances.paramsHash,
          simplifiedPolyline: distances.simplifiedPolyline,
          processedAt: distances.processedAt,
          pipelineVersion,
        },
      });
    },
    {
      maxWait: 10000,
      timeout: 30000,
    }
  );

  logger.info('persistStage: successfully saved processed trip outputs', {
    tripId,
    pipelineVersion,
    nPoints: smoothedPoints.length,
    nStops: stops.length,
    nSegments: segments.length,
    distanceFinalM: distances.distanceFinalM,
  });

  return ctx;
}
