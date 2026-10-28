import type { TripContext, SegmentMatcher, MatchedSegment } from '../types.js';
import { haversineDistanceM } from '../geo/geodesic.js';

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
        let lenM = 0;
        for (let i = 1; i < coords.length; i++) {
          lenM += haversineDistanceM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
        }
        matched.push({
          segmentType: 'unmatched',
          coordinates: coords,
          confidence: seg.confidence,
          lengthM: lenM,
        });
      }
    }

    return matched;
  }
}

/**
 * Stage 6: Segment Matching Stage
 * Executes matcher only when mapMatching.enabled is true AND the trigger condition met.
 */
export async function matchingStage(
  ctx: TripContext,
  matcher: SegmentMatcher = new NoopMatcher()
): Promise<TripContext> {
  const { config, diagnostics } = ctx;

  // Check if map matching is enabled and triggered
  const isTriggered =
    config.mapMatching.enabled &&
    diagnostics?.triggerReason &&
    diagnostics.triggerReason.startsWith('ODOMETER_DISCREPANCY');

  if (!isTriggered) {
    return ctx;
  }

  const matchedSegments = await matcher.match(ctx);
  ctx.matchedSegments = matchedSegments;

  // When matched segments exist, recalculate distanceFinalM
  if (matchedSegments.length > 0 && ctx.distances) {
    let matchedDistanceM = 0;
    for (const m of matchedSegments) {
      if (m.segmentType === 'moving') {
        matchedDistanceM += m.lengthM;
      }
    }
    if (matchedDistanceM > 0) {
      // Connectors and unmatched moving segments keep their smoothed distance
      ctx.distances.distanceFinalM = Math.round(matchedDistanceM * 100) / 100;
    }
  }

  return ctx;
}
