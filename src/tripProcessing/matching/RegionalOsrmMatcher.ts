import pLimit from 'p-limit';
import logger from '../../logger.js';
import type { OsrmRegionalConfig } from '../config.js';
import type {
  MatchedSegment,
  MatcherResult,
  MatchingSummary,
  SegmentMatcher,
  SmoothedPoint,
  TripContext,
} from '../types.js';
import { evaluateWindow } from './acceptance.js';
import type { LonLat } from './geoUtils.js';
import {
  clampRadius,
  downsampleIndices,
  isTransientReason,
  OsrmClient,
  type MatchInputPoint,
} from './osrmClient.js';
import { RegionCache, type OsrmRegion, type RegionSource } from './regionRegistry.js';
import { RegionHealth } from './regionHealth.js';
import { extendWithOverlap, RegionRouter, sendableIndices, type RoutablePoint } from './regionRouter.js';
import { stitch, type Piece } from './stitch.js';

export interface RegionalOsrmMatcherDeps {
  config: OsrmRegionalConfig;
  regionSource: RegionSource;
  cache?: RegionCache;
  health?: RegionHealth;
  client?: OsrmClient;
}

interface ChunkInput {
  chunkIndex: number;
  points: SmoothedPoint[];
  routable: RoutablePoint[];
  confidence: number;
}

interface WindowTask {
  chunkIndex: number;
  /** Piece range in chunk indices */
  a: number;
  b: number;
  /** Core cut range (first/last sent core point) */
  cutFrom: number;
  cutTo: number;
  region: OsrmRegion;
  sent: MatchInputPoint[];
}

/**
 * SegmentMatcher backed by regionally sharded OSRM instances.
 *
 * Per trip: bbox pre-check against the union of region bboxes -> per moving chunk:
 * RegionRouter (coverage + runs) -> windows -> OsrmClient (parallel, p-limit) -> acceptance
 * rules -> stitch. Stop / premise points are never sent. Never throws: any failure degrades to
 * the smoothed path as 'unmatched' with a reason code.
 */
export class RegionalOsrmMatcher implements SegmentMatcher {
  readonly cache: RegionCache;
  readonly health: RegionHealth;
  readonly client: OsrmClient;
  private readonly router: RegionRouter;
  private readonly cfg: OsrmRegionalConfig;

  constructor(deps: RegionalOsrmMatcherDeps) {
    this.cfg = deps.config;
    this.cache = deps.cache ?? new RegionCache(deps.regionSource, this.cfg.regionCacheTtlS);
    this.health = deps.health ?? new RegionHealth(this.cfg);
    this.client = deps.client ?? new OsrmClient(this.cfg);
    this.router = new RegionRouter(this.cfg);
  }

  async match(ctx: TripContext): Promise<MatcherResult> {
    const chunks = collectChunks(ctx);
    try {
      return await this.matchChunks(ctx, chunks);
    } catch (err: any) {
      logger.error('RegionalOsrmMatcher: unexpected error, keeping smoothed path', {
        tripId: ctx.tripId,
        error: err?.message,
        stack: err?.stack,
      });
      return this.allUnmatched(chunks, 'matcher_error', 0);
    }
  }

  private async matchChunks(ctx: TripContext, chunks: ChunkInput[]): Promise<MatcherResult> {
    const t0 = Date.now();
    const snapshot = await this.cache.get();

    // Pre-check: trip bbox vs union of enabled region bboxes (no HTTP if nothing intersects)
    const tripBox = bboxOf(chunks.flatMap((c) => c.routable.filter((p) => p.eligible)));
    if (!tripBox || snapshot.regions.length === 0 || !snapshot.tree.collides(tripBox)) {
      logger.info('RegionalOsrmMatcher: trip outside all OSRM regions, skipping', {
        tripId: ctx.tripId,
        nRegions: snapshot.regions.length,
      });
      return this.allUnmatched(chunks, 'no_region_coverage', 0);
    }

    const limit = pLimit(this.cfg.concurrency);
    const rejectReasons: Record<string, number> = {};
    const countReason = (r: string) => (rejectReasons[r] = (rejectReasons[r] ?? 0) + 1);
    let httpMs = 0;
    let nRuns = 0;
    let nAccepted = 0;
    let nRejected = 0;
    const regionsUsed = new Set<string>();
    const chunkLogs: unknown[] = [];

    const perChunk = await Promise.all(
      chunks.map(async (chunk) => {
        const piecePromises: Array<Promise<Piece>> = [];
        if (chunk.points.length < 2) {
          countReason('too_few_points');
          return { chunk, pieces: [unmatchedPiece(0, Math.max(0, chunk.points.length - 1), 'too_few_points', chunk.confidence)] };
        }

        const plan = this.router.plan(chunk.routable, snapshot);
        nRuns += plan.runs.length;
        chunkLogs.push({
          chunkIndex: chunk.chunkIndex,
          mode: plan.mode,
          coverages: plan.coverages.map((c) => ({ regionId: c.regionId, coverage: Math.round(c.coverage * 1000) / 1000 })),
          runs: plan.runs.map((r) => ({ start: r.start, end: r.end, regionId: r.region?.regionId ?? null })),
        });

        for (const run of plan.runs) {
          if (!run.region) {
            countReason('no_region');
            piecePromises.push(Promise.resolve(unmatchedPiece(run.start, run.end, 'no_region', chunk.confidence)));
            continue;
          }
          const region = run.region;
          const tasks = this.buildWindows(chunk, plan, run, region);
          if (tasks.length === 0) {
            countReason('too_few_points');
            piecePromises.push(Promise.resolve(unmatchedPiece(run.start, run.end, 'too_few_points', chunk.confidence)));
            continue;
          }
          for (const task of tasks) {
            piecePromises.push(
              limit(async (): Promise<Piece> => {
                if (!(await this.health.isHealthy(region))) {
                  return unmatchedPiece(task.a, task.b, 'region_unavailable', chunk.confidence, region);
                }
                const res = await this.client.match(region, task.sent);
                httpMs += res.httpMs;
                if (!res.ok) {
                  if (isTransientReason(res.reason)) this.health.markFailed(region, res.reason);
                  return unmatchedPiece(task.a, task.b, res.reason, chunk.confidence, region);
                }
                const smoothedPath: LonLat[] = [];
                for (let i = task.cutFrom; i <= task.cutTo; i++) {
                  smoothedPath.push([chunk.points[i].longitude, chunk.points[i].latitude]);
                }
                const ev = evaluateWindow(task.sent, res.matchings, res.tracepoints, task.cutFrom, task.cutTo, smoothedPath, this.cfg);
                if (!ev.accepted) {
                  return unmatchedPiece(task.a, task.b, ev.reason, chunk.confidence, region);
                }
                return {
                  a: task.a,
                  b: task.b,
                  matched: true,
                  coordinates: ev.coordinates,
                  confidence: ev.confidence,
                  regionId: region.regionId,
                  dataVersion: region.dataVersion,
                  rejectReason: null,
                };
              })
            );
          }
        }
        const pieces = await Promise.all(piecePromises);
        for (const p of pieces) {
          if (p.matched) {
            nAccepted++;
            if (p.regionId) regionsUsed.add(p.regionId);
          } else if (p.regionId) {
            // window-level rejection (no_region / too_few_points are counted above)
            nRejected++;
            countReason(p.rejectReason ?? 'unknown');
          }
        }
        return { chunk, pieces };
      })
    );

    const segments: MatchedSegment[] = [];
    for (const { chunk, pieces } of perChunk) {
      segments.push(...stitch(pieces, chunk.points, chunk.chunkIndex, this.cfg));
    }

    const summary = summarize(segments, nRuns, regionsUsed, rejectReasons, httpMs);
    logger.info('RegionalOsrmMatcher: trip matched', {
      tripId: ctx.tripId,
      chunks: chunkLogs,
      nRuns,
      windowsAccepted: nAccepted,
      windowsRejected: nRejected,
      rejectReasons,
      regionsUsed: summary.regionsUsed,
      matchedShare: summary.matchedShare,
      httpMs,
      elapsedMs: Date.now() - t0,
    });
    return { segments, summary };
  }

  /** Splits a run into request windows of <= maxPointsPerRequest with overlap. */
  private buildWindows(
    chunk: ChunkInput,
    plan: ReturnType<RegionRouter['plan']>,
    run: { start: number; end: number },
    region: OsrmRegion
  ): WindowTask[] {
    const { overlapPoints: ov, maxPointsPerRequest: maxPts } = this.cfg;
    const ext = extendWithOverlap(plan, chunk.routable, { ...run, region }, ov);
    const cand = sendableIndices(plan, chunk.routable, region.regionId, ext.from, ext.to);
    const core = cand.filter((i) => i >= run.start && i <= run.end);
    if (core.length < 2) return [];

    const pts = chunk.points;
    const t0 = pts[0].deviceTime.getTime() / 1000;
    const dsPoints = pts.map((p) => ({ tsSec: p.deviceTime.getTime() / 1000 - t0, vx: p.vx, vy: p.vy, speedMps: p.speedMps }));
    const D = downsampleIndices(dsPoints, cand, this.cfg.downsampleIntervalS, this.cfg.turnAngleDeg, new Set([core[0], core[core.length - 1]]));

    const cs = D.indexOf(core[0]);
    const ce = D.indexOf(core[core.length - 1]);
    const toInput = (i: number): MatchInputPoint => ({
      index: i,
      lon: pts[i].longitude,
      lat: pts[i].latitude,
      tsSec: pts[i].deviceTime.getTime() / 1000,
      radiusM: clampRadius(pts[i].sigmaM, this.cfg.radiusMinM, this.cfg.radiusMaxM),
    });

    const effOv = Math.min(ov, Math.floor((maxPts - 2) / 2));
    const coreStep = Math.max(1, maxPts - 2 * effOv - 1);
    const tasks: WindowTask[] = [];
    for (let k = cs; k < ce; k += coreStep) {
      const kEnd = Math.min(ce, k + coreStep);
      const from = Math.max(0, k - effOv);
      const to = Math.min(D.length - 1, kEnd + effOv);
      tasks.push({
        chunkIndex: chunk.chunkIndex,
        a: k === cs ? run.start : D[k],
        b: kEnd === ce ? run.end : D[kEnd],
        cutFrom: D[k],
        cutTo: D[kEnd],
        region,
        sent: D.slice(from, to + 1).map(toInput),
      });
    }
    return tasks;
  }

  private allUnmatched(chunks: ChunkInput[], reason: string, httpMs: number): MatcherResult {
    const segments: MatchedSegment[] = [];
    for (const c of chunks) {
      if (c.points.length === 0) continue;
      segments.push(...stitch([unmatchedPiece(0, c.points.length - 1, reason, c.confidence)], c.points, c.chunkIndex, this.cfg));
    }
    return {
      segments,
      summary: summarize(segments, chunks.length, new Set(), chunks.length ? { [reason]: chunks.length } : {}, httpMs),
    };
  }
}

function unmatchedPiece(a: number, b: number, reason: string, confidence: number, region?: OsrmRegion): Piece {
  return {
    a,
    b,
    matched: false,
    confidence,
    regionId: region?.regionId ?? null,
    dataVersion: region?.dataVersion ?? null,
    rejectReason: reason,
  };
}

function summarize(
  segments: MatchedSegment[],
  nRuns: number,
  regionsUsed: Set<string>,
  rejectReasons: Record<string, number>,
  httpMs: number
): MatchingSummary {
  let matchedLen = 0;
  let totalLen = 0;
  let nMatched = 0;
  for (const s of segments) {
    totalLen += s.lengthM;
    if (s.segmentType === 'matched') {
      matchedLen += s.lengthM;
      nMatched++;
    }
  }
  return {
    backend: 'osrm_regional',
    nRuns,
    nMatched,
    nUnmatched: segments.length - nMatched,
    matchedShare: totalLen > 0 ? Math.round((matchedLen / totalLen) * 10000) / 10000 : 0,
    regionsUsed: [...regionsUsed].sort(),
    rejectReasons,
    httpMs,
  };
}

/**
 * Moving chunks from the smoothed points, in time order. Points that belong to a stop or a
 * premise fix are marked ineligible and are never sent to OSRM.
 */
export function collectChunks(ctx: TripContext): ChunkInput[] {
  const absorbed = ctx.absorbedPointIds ?? new Set<number>();
  const byChunk = new Map<number, SmoothedPoint[]>();
  for (const p of ctx.smoothedPoints ?? []) {
    if (p.chunkIndex === undefined) continue;
    let list = byChunk.get(p.chunkIndex);
    if (!list) byChunk.set(p.chunkIndex, (list = []));
    list.push(p);
  }
  const confidenceByChunk = new Map<number, number>();
  for (const s of ctx.segments ?? []) {
    if (s.segmentType === 'moving' && s.chunkIndex !== undefined) confidenceByChunk.set(s.chunkIndex, s.confidence);
  }
  const out: ChunkInput[] = [];
  for (const [chunkIndex, points] of byChunk) {
    if (points.length === 0) continue;
    out.push({
      chunkIndex,
      points,
      routable: points.map((p) => ({
        longitude: p.longitude,
        latitude: p.latitude,
        eligible: isMatchable(p, absorbed),
      })),
      confidence: confidenceByChunk.get(chunkIndex) ?? 0.95,
    });
  }
  out.sort((x, y) => x.points[0].deviceTime.getTime() - y.points[0].deviceTime.getTime());
  return out;
}

export function isMatchable(p: SmoothedPoint, absorbed: ReadonlySet<number>): boolean {
  if (p.source === 'stop_anchor') return false;
  if (p.flags.includes('in_stop')) return false;
  if (p.rawPointId !== undefined && absorbed.has(p.rawPointId)) return false;
  return Number.isFinite(p.latitude) && Number.isFinite(p.longitude);
}

function bboxOf(points: RoutablePoint[]) {
  if (points.length === 0) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.longitude < minX) minX = p.longitude;
    if (p.latitude < minY) minY = p.latitude;
    if (p.longitude > maxX) maxX = p.longitude;
    if (p.latitude > maxY) maxY = p.latitude;
  }
  return { minX, minY, maxX, maxY };
}


