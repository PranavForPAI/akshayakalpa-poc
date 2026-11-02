import type { TripContext, Segment } from '../types.js';

/**
 * Stage 4: Segment Assembly
 * Combines moving chunks, stops, and transition connectors in chronological order:
 * - moving: smoothed points from a moving chunk
 * - connector: last moving smoothed point -> stop anchor OR stop anchor -> first moving smoothed point
 * - stop: stationary stay at stop anchor
 */
export function segmentAssemblyStage(ctx: TripContext): TripContext {
  const chunks = ctx.chunks ?? [];
  const stops = ctx.stops ?? [];
  const smoothedPoints = ctx.smoothedPoints ?? [];

  const segments: Segment[] = [];

  // Group smoothed points by chunk index
  const pointsByChunk = new Map<number, typeof smoothedPoints>();
  for (const pt of smoothedPoints) {
    if (pt.chunkIndex !== undefined) {
      let list = pointsByChunk.get(pt.chunkIndex);
      if (!list) {
        list = [];
        pointsByChunk.set(pt.chunkIndex, list);
      }
      list.push(pt);
    }
  }

  // Intermediate elements to sort chronologically:
  type AssembleItem =
    | { type: 'chunk'; chunkIdx: number; startTs: Date; endTs: Date }
    | { type: 'stop'; stopIdx: number; startTs: Date; endTs: Date };

  const items: AssembleItem[] = [];

  for (const [chunkIdx, pts] of pointsByChunk.entries()) {
    if (pts.length > 0) {
      items.push({
        type: 'chunk',
        chunkIdx,
        startTs: pts[0].deviceTime,
        endTs: pts[pts.length - 1].deviceTime,
      });
    }
  }

  for (let sIdx = 0; sIdx < stops.length; sIdx++) {
    const s = stops[sIdx];
    items.push({
      type: 'stop',
      stopIdx: sIdx,
      startTs: s.arrivalTs,
      endTs: s.departureTs,
    });
  }

  // Sort chronologically by startTs
  items.sort((a, b) => a.startTs.getTime() - b.startTs.getTime());

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    if (item.type === 'chunk') {
      const chunkPts = pointsByChunk.get(item.chunkIdx) ?? [];
      if (chunkPts.length === 0) continue;

      const coords: [number, number][] = chunkPts.map((p) => [p.longitude, p.latitude]);
      segments.push({
        segmentType: 'moving',
        startTs: chunkPts[0].deviceTime,
        endTs: chunkPts[chunkPts.length - 1].deviceTime,
        coordinates: coords,
        source: 'smoothed',
        confidence: 0.95,
        chunkIndex: item.chunkIdx,
      });

      // If followed immediately by a stop, add connector: last moving point -> stop anchor
      const nextItem = i + 1 < items.length ? items[i + 1] : null;
      if (nextItem && nextItem.type === 'stop') {
        const nextStop = stops[nextItem.stopIdx];
        const lastPt = chunkPts[chunkPts.length - 1];
        segments.push({
          segmentType: 'connector',
          startTs: lastPt.deviceTime,
          endTs: nextStop.arrivalTs,
          coordinates: [
            [lastPt.longitude, lastPt.latitude],
            [nextStop.anchorLon, nextStop.anchorLat],
          ],
          source: 'smoothed',
          confidence: 0.9,
        });
      }
    } else {
      // item.type === 'stop'
      const s = stops[item.stopIdx];
      segments.push({
        segmentType: 'stop',
        startTs: s.arrivalTs,
        endTs: s.departureTs,
        coordinates: [s.anchorLon, s.anchorLat],
        source: 'stop_anchor',
        confidence: 1.0,
      });

      // If followed immediately by a moving chunk, add connector: stop anchor -> first moving point
      const nextItem = i + 1 < items.length ? items[i + 1] : null;
      if (nextItem && nextItem.type === 'chunk') {
        const nextPts = pointsByChunk.get(nextItem.chunkIdx) ?? [];
        if (nextPts.length > 0) {
          const firstPt = nextPts[0];
          segments.push({
            segmentType: 'connector',
            startTs: s.departureTs,
            endTs: firstPt.deviceTime,
            coordinates: [
              [s.anchorLon, s.anchorLat],
              [firstPt.longitude, firstPt.latitude],
            ],
            source: 'stop_anchor',
            confidence: 0.9,
          });
        }
      }
    }
  }

  ctx.segments = segments;
  return ctx;
}
