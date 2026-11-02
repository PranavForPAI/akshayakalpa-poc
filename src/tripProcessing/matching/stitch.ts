import type { MatchedSegment } from '../types.js';
import { distLonLatM, lineLengthM, type LonLat } from './geoUtils.js';

/** Result for one contiguous index range [a, b] of a moving chunk (a window or an unmatched run). */
export interface Piece {
  a: number;
  b: number;
  matched: boolean;
  /** Accepted matched geometry (core only, overlap already removed). Ignored when !matched */
  coordinates?: LonLat[];
  confidence: number;
  regionId: string | null;
  dataVersion: string | null;
  rejectReason: string | null;
}

export interface StitchPoint {
  longitude: number;
  latitude: number;
  deviceTime: Date;
}

export interface StitchOptions {
  stitchMaxGapM: number;
  stitchJoinToleranceM: number;
}

/**
 * Merges ordered per-window/per-run pieces of one chunk into MatchedSegments.
 *
 * - Unmatched pieces use the smoothed path from the previous piece's last index to their own
 *   last index, so consecutive unmatched pieces share a vertex and keep the exact smoothed length.
 * - Joins: gap <= stitchJoinToleranceM -> treated as the same vertex; gap <= stitchMaxGapM ->
 *   connected with a short link; gap > stitchMaxGapM -> the segment is BROKEN there (no link is
 *   drawn), so stitching never introduces a jump.
 * - Consecutive connected pieces with the same type, region, data version and reason are
 *   merged into one segment.
 */
export function stitch(
  pieces: Piece[],
  points: StitchPoint[],
  chunkIndex: number,
  opts: StitchOptions
): MatchedSegment[] {
  const out: MatchedSegment[] = [];
  let prevEnd: number | null = null;

  for (const p of pieces) {
    let geom: LonLat[];
    if (p.matched && p.coordinates && p.coordinates.length > 0) {
      geom = p.coordinates.map((c) => [c[0], c[1]] as LonLat);
    } else {
      const from = prevEnd !== null ? Math.min(prevEnd, p.a) : p.a;
      geom = [];
      for (let i = from; i <= p.b; i++) geom.push([points[i].longitude, points[i].latitude]);
    }
    if (geom.length === 1) geom.push(geom[0]);

    const last = out[out.length - 1];
    let connected = false;
    if (last) {
      const lastPt = last.coordinates[last.coordinates.length - 1];
      const gap = distLonLatM(lastPt, geom[0]);
      if (gap <= opts.stitchJoinToleranceM) {
        geom[0] = lastPt;
        connected = true;
      } else if (gap <= opts.stitchMaxGapM) {
        geom.unshift(lastPt);
        connected = true;
      }
    }

    const type = p.matched ? 'matched' : 'unmatched';
    const startTs = points[prevEnd !== null && !p.matched ? Math.min(prevEnd, p.a) : p.a].deviceTime;
    const endTs = points[p.b].deviceTime;

    if (
      last &&
      connected &&
      last.segmentType === type &&
      last.regionId === p.regionId &&
      last.dataVersion === p.dataVersion &&
      last.rejectReason === p.rejectReason
    ) {
      last.coordinates.push(...geom.slice(1));
      last.endTs = endTs;
      last.confidence = Math.min(last.confidence, p.confidence);
    } else {
      out.push({
        segmentType: type,
        coordinates: geom,
        confidence: p.confidence,
        lengthM: 0,
        chunkIndex,
        startTs,
        endTs,
        regionId: p.regionId,
        dataVersion: p.dataVersion,
        rejectReason: p.rejectReason,
        matchedLengthM: null,
      });
    }
    prevEnd = p.b;
  }

  for (const s of out) {
    s.lengthM = lineLengthM(s.coordinates);
    s.matchedLengthM = s.segmentType === 'matched' ? s.lengthM : null;
  }
  return out;
}
