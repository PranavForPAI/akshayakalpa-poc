import type { TripProcessedResponse } from '../types';

/** True when the map matcher ran for this trip (matched/unmatched rows or a summary exist). */
export function hasMatchResult(data: TripProcessedResponse | null | undefined): boolean {
  if (!data) return false;
  if (data.matching) return true;
  return (data.segments ?? []).some(
    (s) => s.segment_type === 'matched' || s.segment_type === 'unmatched'
  );
}

const REASON_LABELS: Record<string, string> = {
  low_confidence: 'Low match confidence',
  length_ratio: 'Matched length too different from GPS path',
  snap_distance: 'Snapped too far from GPS path',
  trace_outliers: 'Too many GPS points rejected by OSRM',
  submatching_gap: 'Gap between matched pieces',
  no_region: 'Outside every OSRM region',
  no_region_coverage: 'Trip outside every OSRM region',
  region_unavailable: 'OSRM region unavailable',
  too_few_points: 'Too few points to match',
  no_match: 'OSRM found no match',
  no_segment: 'No road near the GPS points',
  timeout: 'OSRM request timed out',
  http_5xx: 'OSRM server error',
  network_error: 'Could not reach OSRM',
  matcher_error: 'Matcher error',
};

export function rejectReasonLabel(reason: string | null | undefined): string {
  if (!reason) return 'Not matched';
  return REASON_LABELS[reason] ?? reason.replace(/_/g, ' ');
}
