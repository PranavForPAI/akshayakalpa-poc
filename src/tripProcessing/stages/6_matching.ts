import type { TripContext, SegmentMatcher, MatchedSegment, MatcherResult } from '../types.js';
import { computeFinalDistanceM, computeSegmentDistanceM } from './5_distance.js';
import logger from '../../logger.js';

/**
 * Default No-Op SegmentMatcher implementation.
 * Returns each moving segment as segmentType 'unmatched'.
 */
export class NoopMatcher implements SegmentMatcher {
  async match(ctx: TripContext): Promise<MatchedSegment[]> {
    const segments = ctx.segments ?? [];
    const matched: MatchedSegment[] = [];

    for (const seg of segments) {
      if (seg.segmentType === 'moving' && Array.isArray(seg.coordinates[0])) {
        const coords = seg.coordinates as [number, number][];
        matched.push({
          segmentType: 'unmatched',
          coordinates: coords,
          confidence: seg.confidence,
          lengthM: computeSegmentDistanceM(coords, 'moving'),
          chunkIndex: seg.chunkIndex,
          startTs: seg.startTs,
          endTs: seg.endTs,
          matchedLengthM: null,
        });
      }
    }

    return matched;
  }
}

function normalize(result: MatchedSegment[] | MatcherResult): MatcherResult {
  return Array.isArray(result) ? { segments: result } : result;
}

/**
 * Stage 6: Segment Matching Stage
 * Executes matcher only when mapMatching.enabled is true AND the trigger condition met.
 * A matcher failure never fails the trip: the smoothed result is kept.
 */
export async function matchingStage(
  ctx: TripContext,
  matcher: SegmentMatcher = new NoopMatcher(),
  options: { force?: boolean } = {}
): Promise<TripContext> {
  const { config, diagnostics } = ctx;

  // Check if map matching is enabled and triggered
  const isTriggered =
    config.mapMatching.enabled &&
    diagnostics?.triggerReason &&
    diagnostics.triggerReason.startsWith('ODOMETER_DISCREPANCY');
  const isForced = config.mapMatching.enabled && options.force === true;

  if (!isTriggered && !isForced) {
    return ctx;
  }

  // Record that matching ran because it was forced, keeping the original trigger evaluation
  if (!isTriggered && isForced) {
    const forcedReason = `FORCED_MATCH:${diagnostics?.triggerReason ?? 'NONE'}`;
    if (diagnostics) diagnostics.triggerReason = forcedReason;
    if (ctx.distances) ctx.distances.triggerReason = forcedReason;
  }

  let result: MatcherResult;
  try {
    result = normalize(await matcher.match(ctx));
  } catch (err: any) {
    logger.error('matchingStage: matcher failed, keeping smoothed distance', {
      tripId: ctx.tripId,
      error: err?.message,
    });
    return ctx;
  }

  ctx.matchedSegments = result.segments;
  if (result.summary) ctx.matchingSummary = result.summary;

  // Matched pieces contribute their matched length; everything else keeps its smoothed length
  // (same per-segment logic as the distance stage).
  if (result.segments.length > 0 && ctx.distances) {
    const finalM = computeFinalDistanceM(ctx.segments ?? [], result.segments);
    ctx.distances.distanceFinalM = Math.round(finalM * 100) / 100;
  }

  return ctx;
}
