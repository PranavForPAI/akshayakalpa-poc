import type { OsrmRegionalConfig } from '../config.js';
import type { MatchInputPoint, OsrmMatching, OsrmTracepoint } from './osrmClient.js';
import { distLonLatM, lineLengthM, sliceLineByDistance, type LonLat } from './geoUtils.js';

export type RejectReason =
  | 'low_confidence'
  | 'length_ratio'
  | 'snap_distance'
  | 'trace_outliers'
  | 'submatching_gap'
  | 'invalid_response';

export type WindowEvaluation =
  | {
      accepted: true;
      coordinates: LonLat[];
      confidence: number;
      matchedLengthM: number;
      smoothedLengthM: number;
      maxSnapM: number;
    }
  | {
      accepted: false;
      reason: RejectReason;
      confidence: number | null;
      matchedLengthM: number | null;
      smoothedLengthM: number;
      maxSnapM: number | null;
    };

export type AcceptanceConfig = Pick<
  OsrmRegionalConfig,
  | 'mmMinConfidence'
  | 'mmMinRatio'
  | 'mmMaxRatio'
  | 'ratioMinBaseM'
  | 'maxSnapDistanceM'
  | 'maxDroppedPointFrac'
  | 'stitchMaxGapM'
>;

/**
 * Applies the acceptance rules to one matched window and, if accepted, returns the matched
 * geometry cut to the window's core [cutFrom, cutTo] (chunk indices). Overlap is removed by
 * time: the cut positions are the snapped locations of the first/last core points, located
 * along the matching via the cumulative leg distances of their waypoint_index.
 *
 * Accept only if ALL hold:
 *  - every sub-matching used by the core has confidence >= mmMinConfidence
 *  - matchedLength / smoothedLength within [mmMinRatio, mmMaxRatio] (skipped for very short cores)
 *  - no core point snapped further than maxSnapDistanceM from its smoothed position
 */
export function evaluateWindow(
  sent: MatchInputPoint[],
  matchings: OsrmMatching[],
  tracepoints: Array<OsrmTracepoint | null>,
  cutFrom: number,
  cutTo: number,
  smoothedPath: LonLat[],
  cfg: AcceptanceConfig
): WindowEvaluation {
  const smoothedLengthM = lineLengthM(smoothedPath);
  const reject = (reason: RejectReason, extra: Partial<{ confidence: number | null; matchedLengthM: number | null; maxSnapM: number | null }> = {}): WindowEvaluation => ({
    accepted: false,
    reason,
    confidence: extra.confidence ?? null,
    matchedLengthM: extra.matchedLengthM ?? null,
    smoothedLengthM,
    maxSnapM: extra.maxSnapM ?? null,
  });

  if (tracepoints.length !== sent.length) return reject('invalid_response');

  const core: Array<{ p: MatchInputPoint; tp: OsrmTracepoint | null }> = [];
  for (let k = 0; k < sent.length; k++) {
    if (sent[k].index >= cutFrom && sent[k].index <= cutTo) core.push({ p: sent[k], tp: tracepoints[k] });
  }
  const matched = core.filter((c): c is { p: MatchInputPoint; tp: OsrmTracepoint } => !!c.tp);
  if (matched.length < 2 || (core.length - matched.length) / core.length > cfg.maxDroppedPointFrac) {
    return reject('trace_outliers');
  }

  // Confidence: minimum over the sub-matchings the core uses
  const used = [...new Set(matched.map((c) => c.tp.matchings_index))].sort((a, b) => a - b);
  if (used.some((m) => !matchings[m])) return reject('invalid_response');
  const confidence = Math.min(...used.map((m) => matchings[m].confidence));

  // Snap distances
  let maxSnapM = 0;
  for (const c of matched) {
    const d = distLonLatM([c.p.lon, c.p.lat], c.tp.location);
    if (d > maxSnapM) maxSnapM = d;
  }

  // Geometry cut to the core
  const geometry = cutGeometry(matchings, matched[0].tp, matched[matched.length - 1].tp, cfg.stitchMaxGapM);
  if (!geometry) return reject('submatching_gap', { confidence, maxSnapM });
  const matchedLengthM = lineLengthM(geometry);

  if (confidence < cfg.mmMinConfidence) return reject('low_confidence', { confidence, matchedLengthM, maxSnapM });
  if (smoothedLengthM >= cfg.ratioMinBaseM) {
    const ratio = matchedLengthM / smoothedLengthM;
    if (ratio < cfg.mmMinRatio || ratio > cfg.mmMaxRatio) {
      return reject('length_ratio', { confidence, matchedLengthM, maxSnapM });
    }
  }
  if (maxSnapM > cfg.maxSnapDistanceM) return reject('snap_distance', { confidence, matchedLengthM, maxSnapM });

  return { accepted: true, coordinates: geometry, confidence, matchedLengthM, smoothedLengthM, maxSnapM };
}

/** Distance along the matching geometry (geodesic, m) of a tracepoint, via cumulative leg distances. */
function positionAlong(m: OsrmMatching, waypointIndex: number): number {
  const geomLen = lineLengthM(m.geometry.coordinates);
  let cum = 0;
  for (let i = 0; i < waypointIndex && i < m.legs.length; i++) cum += m.legs[i].distance;
  const scale = m.distance > 0 ? geomLen / m.distance : 1;
  return cum * scale;
}

function cutGeometry(matchings: OsrmMatching[], start: OsrmTracepoint, end: OsrmTracepoint, maxGapM: number): LonLat[] | null {
  const ms = start.matchings_index;
  const me = end.matchings_index;
  if (me < ms) return null;
  if (ms === me) {
    const m = matchings[ms];
    return sliceLineByDistance(m.geometry.coordinates, positionAlong(m, start.waypoint_index), positionAlong(m, end.waypoint_index));
  }
  const parts: LonLat[][] = [];
  const first = matchings[ms];
  parts.push(sliceLineByDistance(first.geometry.coordinates, positionAlong(first, start.waypoint_index), Infinity));
  for (let i = ms + 1; i < me; i++) parts.push(matchings[i].geometry.coordinates);
  const last = matchings[me];
  parts.push(sliceLineByDistance(last.geometry.coordinates, 0, positionAlong(last, end.waypoint_index)));

  const out: LonLat[] = [...parts[0]];
  for (let i = 1; i < parts.length; i++) {
    if (parts[i].length === 0) continue;
    if (distLonLatM(out[out.length - 1], parts[i][0]) > maxGapM) return null;
    out.push(...parts[i]);
  }
  return out;
}
