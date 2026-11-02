import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import type { OsrmRegionalConfig } from '../config.js';
import type { OsrmRegion, RegionSnapshot } from './regionRegistry.js';

export interface RoutablePoint {
  longitude: number;
  latitude: number;
  /** False for points that must never be sent to a matcher (stop / premise points) */
  eligible: boolean;
}

export interface RegionCoverage {
  regionId: string;
  kind: OsrmRegion['kind'];
  /** Fraction of the chunk's eligible points inside the region polygon */
  coverage: number;
}

/** A contiguous index range [start, end] (inclusive) of the chunk assigned to one region (or none). */
export interface Run {
  start: number;
  end: number;
  region: OsrmRegion | null;
}

export interface RoutePlan {
  mode: 'whole' | 'split' | 'none';
  coverages: RegionCoverage[];
  runs: Run[];
  /** covered[i] = ids of regions whose polygon contains point i (eligible points only) */
  covered: Array<Set<string>>;
}

const KIND_RANK: Record<string, number> = { hotspot: 0, backbone: 1 };

/**
 * Chooses OSRM regions for an ordered moving chunk and splits it into contiguous runs.
 *
 * Coverage is computed in a single pass over the points: one rbush query with the chunk's bbox
 * yields candidate regions; each point is then bbox-tested against the candidates and
 * booleanPointInPolygon runs only for bbox hits.
 */
export class RegionRouter {
  constructor(
    private readonly cfg: Pick<OsrmRegionalConfig, 'regionMinCoverage' | 'minRunPoints'>
  ) {}

  plan(points: RoutablePoint[], snapshot: RegionSnapshot): RoutePlan {
    const n = points.length;
    const covered: Array<Set<string>> = Array.from({ length: n }, () => new Set<string>());
    if (n === 0) return { mode: 'none', coverages: [], runs: [], covered };

    // 1. Candidate regions from the chunk bbox (one index query)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      if (!p.eligible) continue;
      if (p.longitude < minX) minX = p.longitude;
      if (p.latitude < minY) minY = p.latitude;
      if (p.longitude > maxX) maxX = p.longitude;
      if (p.latitude > maxY) maxY = p.latitude;
    }
    const candidates = Number.isFinite(minX)
      ? snapshot.tree.search({ minX, minY, maxX, maxY }).map((it) => it.region)
      : [];

    // 2. Single pass: bbox prefilter then point-in-polygon for candidates only
    const counts = new Map<string, number>();
    let nEligible = 0;
    for (let i = 0; i < n; i++) {
      const p = points[i];
      if (!p.eligible) continue;
      nEligible++;
      for (const r of candidates) {
        if (p.longitude < r.minLon || p.longitude > r.maxLon || p.latitude < r.minLat || p.latitude > r.maxLat) continue;
        if (booleanPointInPolygon([p.longitude, p.latitude], r.polygon)) {
          covered[i].add(r.regionId);
          counts.set(r.regionId, (counts.get(r.regionId) ?? 0) + 1);
        }
      }
    }

    const coverages: RegionCoverage[] = candidates
      .filter((r) => (counts.get(r.regionId) ?? 0) > 0)
      .map((r) => ({ regionId: r.regionId, kind: r.kind, coverage: (counts.get(r.regionId) ?? 0) / Math.max(1, nEligible) }));

    // Selection order: hotspot before backbone; within a kind, highest coverage first.
    coverages.sort(
      (a, b) =>
        (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9) ||
        b.coverage - a.coverage ||
        a.regionId.localeCompare(b.regionId)
    );
    const rank = new Map(coverages.map((c, idx) => [c.regionId, idx]));
    const byId = new Map(candidates.map((r) => [r.regionId, r]));

    if (coverages.length === 0) {
      return { mode: 'none', coverages, runs: [{ start: 0, end: n - 1, region: null }], covered };
    }

    const best = coverages[0];
    const whole = best.coverage >= this.cfg.regionMinCoverage;

    // 3. Per-point label = best covering region (whole mode: the best region wherever it covers)
    const labels: Array<string | null> = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (!points[i].eligible) continue;
      if (whole && covered[i].has(best.regionId)) {
        labels[i] = best.regionId;
        continue;
      }
      let bestId: string | null = null;
      for (const id of covered[i]) {
        if (bestId === null || rank.get(id)! < rank.get(bestId)!) bestId = id;
      }
      labels[i] = bestId;
    }
    // Ineligible points inherit the previous label so they never split a run (they are not sent).
    for (let i = 0; i < n; i++) {
      if (!points[i].eligible) labels[i] = i > 0 ? labels[i - 1] : null;
    }
    if (!points[0].eligible) {
      const firstEligibleIdx = points.findIndex((p) => p.eligible);
      const lead = firstEligibleIdx >= 0 ? labels[firstEligibleIdx] : null;
      for (let i = 0; i < n && !points[i].eligible; i++) labels[i] = lead;
    }

    // 4. Contiguous runs, then merge short ones
    let runs: Array<{ start: number; end: number; regionId: string | null }> = [];
    for (let i = 0; i < n; i++) {
      const last = runs[runs.length - 1];
      if (last && last.regionId === labels[i]) last.end = i;
      else runs.push({ start: i, end: i, regionId: labels[i] });
    }
    runs = this.mergeShortRuns(runs, covered, points, this.cfg.minRunPoints);

    return {
      mode: whole ? 'whole' : 'split',
      coverages,
      runs: runs.map((r) => ({ start: r.start, end: r.end, region: r.regionId ? byId.get(r.regionId)! : null })),
      covered,
    };
  }

  /**
   * Merges runs shorter than `minLen` into a neighbour. A short run is absorbed when:
   *  - a neighbour's region covers all of the short run's eligible points, or
   *  - it is sandwiched between two runs of the same region (its uncovered points then stay
   *    in the run's span but are excluded from requests, so coverage is never violated).
   * Uncovered stretches at the edges, or with no compatible neighbour, remain unmatched.
   */
  private mergeShortRuns(
    runs: Array<{ start: number; end: number; regionId: string | null }>,
    covered: Array<Set<string>>,
    points: RoutablePoint[],
    minLen: number
  ) {
    const coversAll = (regionId: string | null, s: number, e: number) => {
      if (!regionId) return false;
      for (let i = s; i <= e; i++) if (points[i].eligible && !covered[i].has(regionId)) return false;
      return true;
    };
    const len = (r: { start: number; end: number }) => r.end - r.start + 1;

    let changed = true;
    while (changed && runs.length > 1) {
      changed = false;
      for (let k = 0; k < runs.length; k++) {
        const r = runs[k];
        if (len(r) >= minLen) continue;
        const prev = runs[k - 1];
        const next = runs[k + 1];
        let target: typeof prev | undefined;
        if (prev && next && prev.regionId && prev.regionId === next.regionId && prev.regionId !== r.regionId) {
          target = prev;
        } else {
          const opts = [prev, next]
            .filter((x): x is NonNullable<typeof x> => !!x && x.regionId !== r.regionId && coversAll(x.regionId, r.start, r.end))
            .sort((a, b) => len(b) - len(a));
          target = opts[0];
        }
        if (!target) continue;
        target.start = Math.min(target.start, r.start);
        target.end = Math.max(target.end, r.end);
        runs.splice(k, 1);
        // coalesce neighbours with the same region
        for (let j = runs.length - 1; j > 0; j--) {
          if (runs[j].regionId === runs[j - 1].regionId) {
            runs[j - 1].end = runs[j].end;
            runs.splice(j, 1);
          }
        }
        changed = true;
        break;
      }
    }
    return runs;
  }
}

/** Indices of points in [from, to] that may be sent to `regionId` (eligible and covered). */
export function sendableIndices(
  plan: RoutePlan,
  points: RoutablePoint[],
  regionId: string,
  from: number,
  to: number
): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) {
    if (points[i].eligible && plan.covered[i].has(regionId)) out.push(i);
  }
  return out;
}

/**
 * Extends a run by up to `overlap` sendable points on each side, stopping at the first point
 * that is ineligible or outside the run's region (so overlap never leaves coverage).
 */
export function extendWithOverlap(
  plan: RoutePlan,
  points: RoutablePoint[],
  run: Run,
  overlap: number
): { from: number; to: number } {
  const id = run.region!.regionId;
  let from = run.start;
  for (let k = 0; k < overlap && from - 1 >= 0; k++) {
    if (!points[from - 1].eligible || !plan.covered[from - 1].has(id)) break;
    from--;
  }
  let to = run.end;
  for (let k = 0; k < overlap && to + 1 < points.length; k++) {
    if (!points[to + 1].eligible || !plan.covered[to + 1].has(id)) break;
    to++;
  }
  return { from, to };
}
