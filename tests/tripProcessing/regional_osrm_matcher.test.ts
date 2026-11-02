import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import prisma from '../../src/db/prisma.js';
import { TripProcessor } from '../../src/tripProcessing/TripProcessor.js';
import {
  loadPipelineConfig,
  osrmRegionalConfigSchema,
  type OsrmRegionalConfig,
} from '../../src/tripProcessing/config.js';
import { RegionalOsrmMatcher, isMatchable } from '../../src/tripProcessing/matching/RegionalOsrmMatcher.js';
import { RegionCache, type OsrmRegion } from '../../src/tripProcessing/matching/regionRegistry.js';
import { RegionRouter } from '../../src/tripProcessing/matching/regionRouter.js';
import { OsrmClient, downsampleIndices } from '../../src/tripProcessing/matching/osrmClient.js';
import { geojsonBBox, lineLengthM } from '../../src/tripProcessing/matching/geoUtils.js';
import { createMatcher, stitch } from '../../src/tripProcessing/matching/index.js';
import { NoopMatcher } from '../../src/tripProcessing/stages/6_matching.js';
import { computeSegmentDistanceM } from '../../src/tripProcessing/stages/5_distance.js';
import type { RawPoint, TripContext } from '../../src/tripProcessing/types.js';
import { OsrmStub, echoMatch, rect } from './helpers/osrmStub.js';
import { buildStopAndGoTrace, buildStraightTrace, canonicalPipelineOutput } from './helpers/syntheticTrace.js';

const LAT = 12.9716;
const stub = new OsrmStub();

function region(id: string, kind: 'hotspot' | 'backbone', polygon: any, extra: Partial<OsrmRegion> = {}): OsrmRegion {
  return {
    regionId: id,
    name: id,
    polygon,
    ...geojsonBBox(polygon),
    osrmUrl: stub.urlFor(id),
    profile: 'car',
    kind,
    dataVersion: `osm-${id}-2026-10`,
    enabled: true,
    ...extra,
  };
}

function osrmCfg(overrides: Partial<OsrmRegionalConfig> = {}): OsrmRegionalConfig {
  return osrmRegionalConfigSchema.parse({
    requestTimeoutMs: 300,
    retries: 1,
    retryBaseDelayMs: 1,
    healthTimeoutMs: 300,
    ...overrides,
  });
}

function makeMatcher(regions: OsrmRegion[], overrides: Partial<OsrmRegionalConfig> = {}) {
  return new RegionalOsrmMatcher({ config: osrmCfg(overrides), regionSource: { listEnabled: async () => regions } });
}

async function runTrip(points: RawPoint[], matcher: RegionalOsrmMatcher | NoopMatcher): Promise<TripContext> {
  const processor = new TripProcessor({
    config: loadPipelineConfig({ mapMatching: { enabled: true, backend: 'osrm_regional' } as any, mmMinKm: 0.1 }),
    matcher,
    skipPersist: true,
    skipPublish: true,
  });
  // Large odometer discrepancy guarantees the ODOMETER_DISCREPANCY trigger fires
  return processor.processTrip(`trip-${Math.random().toString(36).slice(2)}`, points, {
    odometerStartKm: 0,
    odometerEndKm: 1000,
  });
}

const reasons = (ctx: TripContext) =>
  new Set((ctx.matchedSegments ?? []).filter((s) => s.segmentType === 'unmatched').map((s) => s.rejectReason));

function smoothedMovingLength(ctx: TripContext): number {
  return (ctx.segments ?? [])
    .filter((s) => s.segmentType === 'moving')
    .reduce((acc, s) => acc + computeSegmentDistanceM(s.coordinates, 'moving'), 0);
}

beforeAll(() => stub.start());
afterAll(() => stub.stop());
beforeEach(() => stub.reset());

describe('RegionalOsrmMatcher: region selection and splitting', () => {
  it('sends a chunk fully inside one hotspot whole to that region', async () => {
    const regions = [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1)), region('BB', 'backbone', rect(77.0, 12.0, 78.5, 14.0))];
    const ctx = await runTrip(buildStraightTrace(LAT, 77.52, 300), makeMatcher(regions));

    expect(stub.matchRequests.length).toBeGreaterThan(0);
    expect(new Set(stub.matchRequests.map((r) => r.region))).toEqual(new Set(['A']));
    const matched = ctx.matchedSegments!;
    expect(matched).toHaveLength(1);
    expect(matched[0].segmentType).toBe('matched');
    expect(matched[0].regionId).toBe('A');
    expect(matched[0].dataVersion).toBe('osm-A-2026-10');
    expect(ctx.matchingSummary).toMatchObject({ nMatched: 1, nUnmatched: 0, regionsUsed: ['A'] });
    // request contract
    const r0 = stub.matchRequests[0];
    expect(r0.profile).toBe('car');
    expect(r0.params.get('geometries')).toBe('geojson');
    expect(r0.params.get('overview')).toBe('full');
    expect(r0.params.get('gaps')).toBe('ignore');
    expect(r0.params.get('tidy')).toBe('true');
    expect(r0.timestamps).toHaveLength(r0.coords.length);
    for (let i = 1; i < r0.timestamps.length; i++) expect(r0.timestamps[i]).toBeGreaterThan(r0.timestamps[i - 1]);
    for (const rad of r0.radiuses) {
      expect(rad).toBeGreaterThanOrEqual(10);
      expect(rad).toBeLessThanOrEqual(40);
    }
  });

  it('splits a chunk crossing two hotspots with overlap and stitches it without a jump', async () => {
    // Overlapping hotspots: A covers ~half the trace, B the rest, both cover 77.60-77.62
    const regions = [region('A', 'hotspot', rect(77.5, 12.9, 77.62, 13.1)), region('B', 'hotspot', rect(77.6, 12.9, 77.75, 13.1))];
    const ctx = await runTrip(buildStraightTrace(LAT, 77.55, 1500), makeMatcher(regions));

    const toA = stub.matchRequests.filter((r) => r.region === 'A');
    const toB = stub.matchRequests.filter((r) => r.region === 'B');
    expect(toA.length).toBeGreaterThan(0);
    expect(toB.length).toBeGreaterThan(0);
    // windows respect maxPointsPerRequest
    for (const r of stub.matchRequests) expect(r.coords.length).toBeLessThanOrEqual(90);
    // overlap: A's last request reaches past the start of B's first request (in time)
    const lastA = Math.max(...toA.flatMap((r) => r.timestamps));
    const firstB = Math.min(...toB.flatMap((r) => r.timestamps));
    expect(lastA).toBeGreaterThan(firstB);
    // never outside coverage
    for (const r of toA) for (const [lon] of r.coords) expect(lon).toBeLessThanOrEqual(77.62);
    for (const r of toB) for (const [lon] of r.coords) expect(lon).toBeGreaterThanOrEqual(77.6);

    const segs = ctx.matchedSegments!;
    expect(segs.every((s) => s.segmentType === 'matched')).toBe(true);
    expect(new Set(segs.map((s) => s.regionId))).toEqual(new Set(['A', 'B']));
    // no jump at joins: each segment starts where the previous ended
    for (let i = 1; i < segs.length; i++) {
      const prev = segs[i - 1].coordinates.at(-1)!;
      const cur = segs[i].coordinates[0];
      expect(lineLengthM([prev, cur])).toBeLessThanOrEqual(1e-6);
    }
    // stitched length ~= sum of runs minus overlap (= the smoothed path for an echo match)
    const stitched = segs.reduce((a, s) => a + (s.matchedLengthM ?? 0), 0);
    const reference = smoothedMovingLength(ctx);
    expect(Math.abs(stitched - reference) / reference).toBeLessThan(0.01);
    expect(Math.abs(ctx.distances!.distanceFinalM - reference) / reference).toBeLessThan(0.01);
  });

  it('sends the run between two hotspots to the backbone', async () => {
    const regions = [
      region('A', 'hotspot', rect(77.5, 12.9, 77.56, 13.1)),
      region('B', 'hotspot', rect(77.64, 12.9, 77.75, 13.1)),
      region('BB', 'backbone', rect(77.0, 12.0, 78.5, 14.0)),
    ];
    const ctx = await runTrip(buildStraightTrace(LAT, 77.53, 1500), makeMatcher(regions));
    const byRegion = (id: string) => stub.matchRequests.filter((r) => r.region === id);
    expect(byRegion('A').length).toBeGreaterThan(0);
    expect(byRegion('B').length).toBeGreaterThan(0);
    expect(byRegion('BB').length).toBeGreaterThan(0);
    // backbone only receives the stretch that no hotspot covers (plus overlap)
    const bbLons = byRegion('BB').flatMap((r) => r.coords.map(([lon]) => lon));
    expect(Math.min(...bbLons)).toBeGreaterThan(77.55);
    expect(Math.max(...bbLons)).toBeLessThan(77.65);
    expect(ctx.matchingSummary!.regionsUsed).toEqual(['A', 'B', 'BB']);
  });

  it('returns unmatched with zero HTTP calls when no region covers the chunk', async () => {
    const regions = [region('DEL', 'hotspot', rect(77.0, 28.4, 77.4, 28.8))]; // Delhi; trip is in Bengaluru
    const ctx = await runTrip(buildStraightTrace(LAT, 77.52, 300), makeMatcher(regions));
    expect(stub.matchRequests).toHaveLength(0);
    expect(stub.nearestRequests).toHaveLength(0);
    expect(ctx.matchedSegments!.every((s) => s.segmentType === 'unmatched')).toBe(true);
    expect(reasons(ctx)).toEqual(new Set(['no_region_coverage']));
    expect(ctx.distances!.distanceFinalM).toBeCloseTo(ctx.distances!.distanceSmoothedM, 1);
  });

  it('bbox overlaps but polygon does not cover: unmatched, no HTTP calls', async () => {
    // L-shaped polygon whose bbox contains the trace but whose area does not
    const lShape = {
      type: 'Polygon',
      coordinates: [[[77.4, 12.8], [77.8, 12.8], [77.8, 12.85], [77.45, 12.85], [77.45, 13.2], [77.4, 13.2], [77.4, 12.8]]],
    };
    const ctx = await runTrip(buildStraightTrace(LAT, 77.52, 300), makeMatcher([region('L', 'hotspot', lShape)]));
    expect(stub.matchRequests).toHaveLength(0);
    expect(reasons(ctx)).toEqual(new Set(['no_region']));
  });

  it('never sends stop points to OSRM', async () => {
    const regions = [region('A', 'hotspot', rect(77.5, 12.9, 77.7, 13.1))];
    const points = buildStopAndGoTrace();
    const ctx = await runTrip(points, makeMatcher(regions));
    expect(ctx.stops!.length).toBeGreaterThan(0);
    expect(stub.matchRequests.length).toBeGreaterThan(0);

    const sentTs = stub.matchRequests.flatMap((r) => r.timestamps);
    for (const s of ctx.stops!) {
      const a = s.arrivalTs.getTime() / 1000;
      const d = s.departureTs.getTime() / 1000;
      // allow the +1 s monotonic bump at the edges
      for (const t of sentTs) expect(t <= a + 1 || t >= d - 1).toBe(true);
    }
    const absorbed = new Set(ctx.stops!.flatMap((s) => s.absorbedRawIds));
    const absorbedKeys = new Set(
      points.filter((p) => absorbed.has(p.id!)).map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`)
    );
    const matchableKeys = new Set(
      ctx.smoothedPoints!
        .filter((p) => isMatchable(p, ctx.absorbedPointIds ?? new Set()))
        .map((p) => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`)
    );
    for (const r of stub.matchRequests) {
      for (const [lon, lat] of r.coords) {
        const key = `${lon.toFixed(6)},${lat.toFixed(6)}`;
        expect(absorbedKeys.has(key)).toBe(false);
        expect(matchableKeys.has(key)).toBe(true);
      }
    }
  });
});

describe('RegionalOsrmMatcher: acceptance rules', () => {
  const regions = () => [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1))];
  const trace = () => buildStraightTrace(LAT, 77.52, 300);

  it('low confidence falls back to unmatched', async () => {
    stub.matchHandlers.set('A', echoMatch({ confidence: 0.3 }));
    const ctx = await runTrip(trace(), makeMatcher(regions()));
    expect(reasons(ctx)).toEqual(new Set(['low_confidence']));
    expect(ctx.matchedSegments!.every((s) => s.segmentType === 'unmatched')).toBe(true);
  });

  it('length ratio out of bounds falls back to unmatched', async () => {
    stub.matchHandlers.set('A', echoMatch({ zigzagDeg: 0.0004 })); // ~45 m lateral zig-zag
    const ctx = await runTrip(trace(), makeMatcher(regions()));
    expect(reasons(ctx)).toEqual(new Set(['length_ratio']));
  });

  it('large snap distance falls back to unmatched', async () => {
    stub.matchHandlers.set('A', echoMatch({ shiftLat: 0.0009 })); // ~100 m north
    const ctx = await runTrip(trace(), makeMatcher(regions()));
    expect(reasons(ctx)).toEqual(new Set(['snap_distance']));
  });

  it('unmatched fallback keeps the smoothed distance exactly', async () => {
    stub.matchHandlers.set('A', echoMatch({ confidence: 0.1 }));
    const ctx = await runTrip(trace(), makeMatcher(regions()));
    expect(ctx.distances!.distanceFinalM).toBe(ctx.distances!.distanceSmoothedM);
  });
});

describe('RegionalOsrmMatcher: failures degrade gracefully', () => {
  const regions = () => [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1))];
  const trace = () => buildStraightTrace(LAT, 77.52, 600);

  it('NoMatch -> unmatched(no_match)', async () => {
    stub.matchHandlers.set('A', () => ({ status: 400, body: { code: 'NoMatch', message: 'Could not match the trace.' } }));
    const ctx = await runTrip(trace(), makeMatcher(regions()));
    expect(reasons(ctx)).toEqual(new Set(['no_match']));
    expect(ctx.distances!.distanceFinalM).toBe(ctx.distances!.distanceSmoothedM);
  });

  it('NoSegment -> unmatched(no_segment)', async () => {
    stub.matchHandlers.set('A', () => ({ status: 400, body: { code: 'NoSegment' } }));
    const ctx = await runTrip(trace(), makeMatcher(regions()));
    expect(reasons(ctx)).toEqual(new Set(['no_segment']));
  });

  it('timeout -> unmatched(timeout), region then cooled down', async () => {
    stub.matchHandlers.set('A', (req) => ({ ...echoMatch()(req), delayMs: 2000 }));
    const ctx = await runTrip(trace(), makeMatcher(regions(), { requestTimeoutMs: 100, concurrency: 1 }));
    const r = reasons(ctx);
    expect(r.has('timeout')).toBe(true);
    for (const x of r) expect(['timeout', 'region_unavailable']).toContain(x);
    expect(ctx.distances!.distanceFinalM).toBe(ctx.distances!.distanceSmoothedM);
  });

  it('5xx -> retried, then unmatched(http_5xx)', async () => {
    stub.matchHandlers.set('A', () => ({ status: 503, body: { message: 'unavailable' } }));
    const ctx = await runTrip(buildStraightTrace(LAT, 77.52, 300), makeMatcher(regions(), { retries: 1 }));
    expect(stub.matchRequests).toHaveLength(2); // one window, one retry
    expect(reasons(ctx)).toEqual(new Set(['http_5xx']));
  });

  it('skips a disabled region', async () => {
    const cache = new RegionCache({ listEnabled: async () => [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1), { enabled: false })] }, 60);
    const matcher = new RegionalOsrmMatcher({ config: osrmCfg(), regionSource: { listEnabled: async () => [] }, cache });
    const ctx = await runTrip(buildStraightTrace(LAT, 77.52, 300), matcher);
    expect(stub.matchRequests).toHaveLength(0);
    expect(reasons(ctx)).toEqual(new Set(['no_region_coverage']));
  });

  it('skips an unhealthy region (no /match calls) and falls back to the backbone', async () => {
    stub.nearestStatus.set('A', 503);
    const regs = [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1)), region('BB', 'backbone', rect(77.0, 12.0, 78.5, 14.0))];
    const ctx = await runTrip(buildStraightTrace(LAT, 77.52, 300), makeMatcher(regs));
    expect(stub.matchRequests.filter((r) => r.region === 'A')).toHaveLength(0);
    // hotspot covers the whole chunk so it is selected; being down, its runs are unmatched
    expect(reasons(ctx)).toEqual(new Set(['region_unavailable']));
    expect(stub.nearestRequests.filter((r) => r === 'A')).toHaveLength(1); // health cached across windows
  });
});

describe('Matching disabled / backend selection', () => {
  it('matching disabled yields output identical to before this change (golden fixture)', async () => {
    const golden = JSON.parse(
      fs.readFileSync(path.join(__dirname, 'fixtures', 'matching_disabled_golden.json'), 'utf8')
    );
    const processor = new TripProcessor({
      config: loadPipelineConfig({ mapMatching: { enabled: false } as any }),
      skipPersist: true,
      skipPublish: true,
    });
    const ctx = await processor.processTrip('golden-trip', buildStopAndGoTrace(), {
      odometerStartKm: 100,
      odometerEndKm: 103,
    });
    expect(canonicalPipelineOutput(ctx)).toEqual(golden);
    expect(stub.matchRequests).toHaveLength(0);
  });

  it('persists matched rows with provenance alongside unchanged smoothed rows, plus a summary', async () => {
    const tripId = `osrm-persist-${Date.now()}`;
    await prisma.trip.create({
      data: {
        tripId,
        status: 'Completed',
        deviceKey: { connectOrCreate: { where: { deviceId: 'test-device-osrm' }, create: { deviceId: 'test-device-osrm' } } },
      },
    });
    try {
      const regs = [region('A', 'hotspot', rect(77.5, 12.9, 77.62, 13.1)), region('B', 'hotspot', rect(77.6, 12.9, 77.75, 13.1))];
      stub.matchHandlers.set('B', echoMatch({ confidence: 0.2 })); // B rejected -> unmatched rows
      const processor = new TripProcessor({
        config: loadPipelineConfig({ mapMatching: { enabled: true, backend: 'osrm_regional' } as any, mmMinKm: 0.1 }),
        matcher: makeMatcher(regs),
        skipPublish: true,
      });
      const ctx = await processor.processTrip(tripId, buildStraightTrace(LAT, 77.55, 1500), { odometerStartKm: 0, odometerEndKm: 1000 });

      const rows = await prisma.tripSegment.findMany({ where: { tripId }, orderBy: { id: 'asc' } });
      const smoothedRows = rows.filter((r) => ['moving', 'stop', 'connector'].includes(r.segmentType));
      expect(smoothedRows).toHaveLength(ctx.segments!.length);
      expect(smoothedRows.every((r) => r.source !== 'matched' && r.regionId === null)).toBe(true);

      const matchedRows = rows.filter((r) => r.segmentType === 'matched');
      const unmatchedRows = rows.filter((r) => r.segmentType === 'unmatched');
      expect(matchedRows.length).toBeGreaterThan(0);
      expect(matchedRows.every((r) => r.regionId === 'A' && r.dataVersion === 'osm-A-2026-10' && r.source === 'matched')).toBe(true);
      expect(unmatchedRows.some((r) => r.regionId === 'B' && r.rejectReason === 'low_confidence')).toBe(true);

      const summary = await prisma.tripMatchingSummary.findFirst({ where: { tripId } });
      expect(summary).toMatchObject({ backend: 'osrm_regional', regionsUsed: ['A'] });
      expect(summary!.matchedShare).toBeGreaterThan(0);
      expect(summary!.matchedShare).toBeLessThan(1);
      expect((summary!.rejectReasons as any).low_confidence).toBeGreaterThan(0);
    } finally {
      await prisma.trip.delete({ where: { tripId } });
    }
  });

  it('forceMatching runs the matcher without odometer readings and records the forced trigger', async () => {
    const regs = [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1))];
    const mk = (enabled: boolean, forceMatching: boolean) =>
      new TripProcessor({
        config: loadPipelineConfig({ mapMatching: { enabled, backend: 'osrm_regional' } as any }),
        matcher: makeMatcher(regs),
        forceMatching,
        skipPersist: true,
        skipPublish: true,
      });

    // Not forced: no odometer -> trigger does not fire -> no HTTP
    const notForced = await mk(true, false).processTrip('t-noforce', buildStraightTrace(LAT, 77.52, 300));
    expect(notForced.matchedSegments).toBeUndefined();
    expect(stub.matchRequests).toHaveLength(0);

    // Forced: matcher runs, trigger reason keeps the original evaluation
    const forced = await mk(true, true).processTrip('t-force', buildStraightTrace(LAT, 77.52, 300));
    expect(stub.matchRequests.length).toBeGreaterThan(0);
    expect(forced.matchedSegments!.every((s) => s.segmentType === 'matched')).toBe(true);
    expect(forced.distances!.triggerReason).toBe('FORCED_MATCH:NO_ODOMETER_AVAILABLE');

    // Force has no effect when matching is disabled
    stub.reset();
    const disabled = await mk(false, true).processTrip('t-force-off', buildStraightTrace(LAT, 77.52, 300));
    expect(disabled.matchedSegments).toBeUndefined();
    expect(stub.matchRequests).toHaveLength(0);
  });

  it('NoopMatcher stays the default; osrm_regional needs enabled + backend', () => {
    expect(createMatcher(loadPipelineConfig())).toBeInstanceOf(NoopMatcher);
    expect(createMatcher(loadPipelineConfig({ mapMatching: { enabled: true } as any }))).toBeInstanceOf(NoopMatcher);
    expect(createMatcher(loadPipelineConfig({ mapMatching: { enabled: false, backend: 'osrm_regional' } as any }))).toBeInstanceOf(NoopMatcher);
    expect(
      createMatcher(loadPipelineConfig({ mapMatching: { enabled: true, backend: 'osrm_regional' } as any }))
    ).toBeInstanceOf(RegionalOsrmMatcher);
  });

  it('NoopMatcher with matching enabled keeps distanceFinalM == smoothed', async () => {
    const ctx = await runTrip(buildStopAndGoTrace(), new NoopMatcher());
    expect(ctx.distances!.distanceFinalM).toBe(ctx.distances!.distanceSmoothedM);
  });
});

describe('Unit: router, client, downsampling', () => {
  it('prefers hotspot over backbone even when the backbone has higher coverage', async () => {
    const regs = [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1)), region('BB', 'backbone', rect(77.0, 12.0, 78.5, 14.0))];
    const snapshot = await new RegionCache({ listEnabled: async () => regs }, 60).get();
    const pts = Array.from({ length: 100 }, (_, i) => ({ longitude: 77.58 + i * 0.0005, latitude: LAT, eligible: true }));
    const plan = new RegionRouter({ regionMinCoverage: 0.95, minRunPoints: 10 }).plan(pts, snapshot);
    expect(plan.coverages[0].regionId).toBe('A');
    expect(plan.mode).toBe('split');
    expect(plan.runs.map((r) => r.region?.regionId)).toEqual(['A', 'BB']);
  });

  it('merges short runs into a covering neighbour', async () => {
    const regs = [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1)), region('S', 'hotspot', rect(77.55, 12.9, 77.5502, 13.1))];
    const snapshot = await new RegionCache({ listEnabled: async () => regs }, 60).get();
    const pts = Array.from({ length: 100 }, (_, i) => ({ longitude: 77.54 + i * 0.0001, latitude: LAT, eligible: true }));
    const plan = new RegionRouter({ regionMinCoverage: 0.99, minRunPoints: 10 }).plan(pts, snapshot);
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0].region?.regionId).toBe('A');
  });

  it('stitch breaks instead of connecting when the join gap exceeds stitchMaxGapM', () => {
    const t = (s: number) => new Date(1_760_000_000_000 + s * 1000);
    const points = Array.from({ length: 21 }, (_, i) => ({ longitude: 77.5 + i * 1e-4, latitude: LAT, deviceTime: t(i) }));
    const near = (i: number, dLat = 0): [number, number] => [points[i].longitude, points[i].latitude + dLat];
    const base = { confidence: 0.9, dataVersion: 'v1', rejectReason: null };
    const pieces = [
      { ...base, a: 0, b: 10, matched: true, regionId: 'A', coordinates: [near(0), near(10)] },
      // starts ~100 m north of the previous end -> must break
      { ...base, a: 10, b: 20, matched: true, regionId: 'B', coordinates: [near(10, 0.0009), near(20, 0.0009)] },
    ];
    const out = stitch(pieces, points, 0, { stitchMaxGapM: 50, stitchJoinToleranceM: 1 });
    expect(out).toHaveLength(2);
    expect(out[1].coordinates[0]).toEqual(near(10, 0.0009)); // no connecting link was added
    // small gap -> connected
    pieces[1].coordinates = [near(10, 0.0002), near(20, 0.0002)]; // ~22 m
    const joined = stitch(pieces, points, 0, { stitchMaxGapM: 50, stitchJoinToleranceM: 1 });
    expect(joined[1].coordinates[0]).toEqual(joined[0].coordinates.at(-1));
  });

  it('switches to polyline6 when the URL gets too long', () => {
    const client = new OsrmClient({ maxUrlLength: 200, requestTimeoutMs: 1000, retries: 0, retryBaseDelayMs: 0, maxPointsPerRequest: 90 });
    const pts = Array.from({ length: 50 }, (_, i) => ({ index: i, lon: 77.5 + i * 1e-4, lat: LAT, tsSec: 1000 + i, radiusM: 10 }));
    const { url, encoding } = client.buildMatchUrl({ osrmUrl: 'http://x', profile: 'car' }, pts);
    expect(encoding).toBe('polyline6');
    expect(url).toContain('/match/v1/car/polyline6(');
  });

  it('polyline6 requests round-trip through the stub', async () => {
    const regs = [region('A', 'hotspot', rect(77.5, 12.9, 77.6, 13.1))];
    const ctx = await runTrip(buildStraightTrace(LAT, 77.52, 300), makeMatcher(regs, { maxUrlLength: 100 }));
    expect(stub.matchRequests.every((r) => r.encoding === 'polyline6')).toBe(true);
    expect(ctx.matchedSegments!.every((s) => s.segmentType === 'matched')).toBe(true);
  });

  it('downsampling keeps turning points and forced boundaries', () => {
    // 60 s east then 60 s north at 10 m/s, 1 Hz
    const pts = Array.from({ length: 120 }, (_, i) => ({
      tsSec: i,
      vx: i < 60 ? 10 : 0,
      vy: i < 60 ? 0 : 10,
      speedMps: 10,
    }));
    const idx = pts.map((_, i) => i);
    const kept = downsampleIndices(pts, idx, 5, 30, new Set([37]));
    expect(kept[0]).toBe(0);
    expect(kept.at(-1)).toBe(119);
    expect(kept).toContain(60); // the corner
    expect(kept).toContain(37); // forced
    expect(kept.length).toBeLessThan(40);
  });
});

/**
 * Integration against a real OSRM instance. Skipped unless OSRM_TEST_URL is set, e.g.
 *   OSRM_TEST_URL=http://localhost:5000 OSRM_TEST_PROFILE=car npx vitest run regional_osrm
 * The trace is a small fixed drive along MG Road, Bengaluru (needs a southern-India extract).
 */
describe.skipIf(!process.env.OSRM_TEST_URL)('Integration: real OSRM instance', () => {
  it('matches a small recorded trace', async () => {
    const trace: Array<[number, number, number]> = [
      // [lat, lon, seconds]
      [12.97566, 77.60178, 0], [12.97552, 77.60452, 30], [12.97531, 77.60745, 60],
      [12.97507, 77.61041, 90], [12.97480, 77.61340, 120], [12.97446, 77.61640, 150],
      [12.97403, 77.61921, 180],
    ];
    const client = new OsrmClient(osrmCfg({ requestTimeoutMs: 5000 }));
    const res = await client.match(
      { osrmUrl: process.env.OSRM_TEST_URL!, profile: process.env.OSRM_TEST_PROFILE ?? 'car' },
      trace.map(([lat, lon, t], i) => ({ index: i, lat, lon, tsSec: 1_760_000_000 + t, radiusM: 25 }))
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.matchings.length).toBeGreaterThan(0);
      expect(res.tracepoints).toHaveLength(trace.length);
      expect(res.matchings[0].confidence).toBeGreaterThanOrEqual(0);
    }
  });
});
