import { describe, it, expect } from 'vitest';
import { TripProcessor } from '../../src/tripProcessing/TripProcessor.js';
import type { RawPoint } from '../../src/tripProcessing/types.js';
import { loadPipelineConfig } from '../../src/tripProcessing/config.js';
import { haversineDistanceM } from '../../src/tripProcessing/geo/geodesic.js';

describe('Stop Detection and Gap Splitting Tests', () => {
  it('stationary jitter: 5 minutes of noisy fixes around one point gives exactly 1 Stop, 0 internal distance, and no points reach Kalman', async () => {
    // 5 minutes @ 2s = 150 points around (12.9716, 77.5946)
    const baseLat = 12.9716;
    const baseLon = 77.5946;
    const baseTime = new Date('2026-03-01T12:00:00Z').getTime();

    const metersPerDegLat = 110574;
    const metersPerDegLon = 111320 * Math.cos((baseLat * Math.PI) / 180);

    const points: RawPoint[] = [];
    for (let i = 0; i < 150; i++) {
      // Jitter displacement within 8 meters
      const offsetEast = ((i % 5) - 2) * 2;
      const offsetNorth = (((i * 3) % 5) - 2) * 2;

      points.push({
        id: i + 1,
        latitude: baseLat + offsetNorth / metersPerDegLat,
        longitude: baseLon + offsetEast / metersPerDegLon,
        deviceTime: new Date(baseTime + i * 2000),
        accuracyMeters: 6.0,
        speedMps: 0.2, // Near zero Doppler speed
        speedAccuracyMps: 0.1,
        headingDegrees: (i * 37) % 360,
      });
    }

    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const ctx = await processor.processTrip('stationary-jitter-trip', points);

    // 1. Exactly one Stop
    expect(ctx.stops).toBeDefined();
    expect(ctx.stops!.length).toBe(1);
    const stop = ctx.stops![0];
    expect(stop.reason).toBe('jitter');
    expect(stop.dwellS).toBeGreaterThanOrEqual(290);
    expect(stop.absorbedRawIds.length).toBe(150);

    // 2. Zero internal distance for stops
    expect(ctx.distances!.distanceSmoothedM).toBe(0);

    // 3. None of its points reach the Kalman stage
    expect(ctx.chunks!.length).toBe(0);
    expect(ctx.smoothedPoints!.length).toBe(0);
  });

  it('premise enter and exit: moving -> 10 min jitter -> moving gives two connectors and one stop', async () => {
    const baseTime = new Date('2026-03-01T14:00:00Z').getTime();
    const points: RawPoint[] = [];
    let ptId = 1;

    const metersPerDegLat = 110574;
    const metersPerDegLon = 111320 * Math.cos((12.9716 * Math.PI) / 180);

    // 1. Phase 1: Moving inbound (20 fixes @ 2s, traveling 10 m/s toward premise)
    for (let i = 0; i < 20; i++) {
      points.push({
        id: ptId++,
        latitude: 12.96 + (i * 20) / metersPerDegLat,
        longitude: 77.59,
        deviceTime: new Date(baseTime + (ptId * 2000)),
        accuracyMeters: 5.0,
        speedMps: 10.0,
        speedAccuracyMps: 0.5,
        headingDegrees: 0,
      });
    }

    // 2. Phase 2: Stationary jitter inside premise (10 minutes = 300 fixes @ 2s)
    const premiseAnchorLat = 12.964;
    const premiseAnchorLon = 77.59;
    const jitterStartTime = points[points.length - 1].deviceTime.getTime() + 2000;

    for (let i = 0; i < 300; i++) {
      const jx = ((i % 7) - 3) * 1.5;
      const jy = (((i * 4) % 7) - 3) * 1.5;
      points.push({
        id: ptId++,
        latitude: premiseAnchorLat + jy / metersPerDegLat,
        longitude: premiseAnchorLon + jx / metersPerDegLon,
        deviceTime: new Date(jitterStartTime + i * 2000),
        accuracyMeters: 5.0,
        speedMps: 0.1,
        speedAccuracyMps: 0.1,
        headingDegrees: 0,
      });
    }

    // 3. Phase 3: Moving outbound (20 fixes @ 2s, exiting at 10 m/s)
    const outboundStartTime = points[points.length - 1].deviceTime.getTime() + 2000;
    for (let i = 0; i < 20; i++) {
      points.push({
        id: ptId++,
        latitude: premiseAnchorLat + ((i + 1) * 20) / metersPerDegLat,
        longitude: 77.59,
        deviceTime: new Date(outboundStartTime + i * 2000),
        accuracyMeters: 5.0,
        speedMps: 10.0,
        speedAccuracyMps: 0.5,
        headingDegrees: 0,
      });
    }

    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const ctx = await processor.processTrip('premise-enter-exit-trip', points);

    // Verify 1 Stop
    expect(ctx.stops).toBeDefined();
    expect(ctx.stops!.length).toBe(1);

    // Verify connectors: exactly two connector segments
    const connectors = ctx.segments!.filter((s) => s.segmentType === 'connector');
    expect(connectors.length).toBe(2);

    // Verify moving segments
    const movingSegments = ctx.segments!.filter((s) => s.segmentType === 'moving');
    expect(movingSegments.length).toBe(2);

    // Order should be: moving -> connector -> stop -> connector -> moving
    const types = ctx.segments!.map((s) => s.segmentType);
    expect(types).toEqual(['moving', 'connector', 'stop', 'connector', 'moving']);
  });

  it('gap test: 60 s gap splits the chunk; no smoothing across it', async () => {
    const baseTime = new Date('2026-03-01T16:00:00Z').getTime();
    const points: RawPoint[] = [];

    // Part A: 10 fixes at 2s interval
    for (let i = 0; i < 10; i++) {
      points.push({
        id: i + 1,
        latitude: 12.9716 + i * 0.0001,
        longitude: 77.5946,
        deviceTime: new Date(baseTime + i * 2000),
        accuracyMeters: 5.0,
        speedMps: 6.0,
        speedAccuracyMps: 0.5,
        headingDegrees: 0,
      });
    }

    // 60-second gap
    const partBStartTime = baseTime + 9 * 2000 + 60000;

    // Part B: 10 fixes at 2s interval
    for (let i = 0; i < 10; i++) {
      points.push({
        id: 11 + i,
        latitude: 12.9750 + i * 0.0001,
        longitude: 77.5946,
        deviceTime: new Date(partBStartTime + i * 2000),
        accuracyMeters: 5.0,
        speedMps: 6.0,
        speedAccuracyMps: 0.5,
        headingDegrees: 0,
      });
    }

    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const ctx = await processor.processTrip('gap-trip-1', points);

    // Must be split into 2 distinct moving chunks
    expect(ctx.chunks!.length).toBe(2);
    expect(ctx.chunks![0].points.length).toBe(10);
    expect(ctx.chunks![1].points.length).toBe(10);

    // ...but the path stays continuous: one 'gap' connector joins the two chunks
    const segs = ctx.segments!;
    expect(segs.map((x) => `${x.segmentType}:${x.source}`)).toEqual([
      'moving:smoothed',
      'connector:gap',
      'moving:smoothed',
    ]);
    const gap = segs[1].coordinates as [number, number][];
    const movA = segs[0].coordinates as [number, number][];
    const movB = segs[2].coordinates as [number, number][];
    expect(gap[0]).toEqual(movA[movA.length - 1]);
    expect(gap[1]).toEqual(movB[0]);

    // ...and the straight-line gap counts towards distance
    const gapM = haversineDistanceM(gap[0][1], gap[0][0], gap[1][1], gap[1][0]);
    expect(gapM).toBeGreaterThan(250);
    const legacy = await new TripProcessor({
      config: loadPipelineConfig({ bridgeGaps: false }),
      skipPersist: true,
      skipPublish: true,
    }).processTrip('gap-trip-1', points);
    expect(legacy.segments!.map((x) => x.segmentType)).toEqual(['moving', 'moving']);
    expect(ctx.distances!.distanceSmoothedM - legacy.distances!.distanceSmoothedM).toBeCloseTo(gapM, 0);
  });
});

describe('Low-accuracy fixes (large accuracy circle)', () => {
  const baseTime = new Date('2026-03-01T17:00:00Z').getTime();
  const M_LAT = 110574;
  /** 20 s good, 30 s of fixes with a big accuracy circle scattered around a centre, 20 s good */
  function trace(badAccuracyM: number): { points: RawPoint[]; badCentre: [number, number] } {
    const points: RawPoint[] = [];
    let id = 1;
    const lat0 = 12.9716;
    const lon0 = 77.5946;
    const push = (t: number, lat: number, acc: number, speed: number | null, heading: number | null) =>
      points.push({
        id: id++,
        latitude: lat,
        longitude: lon0,
        deviceTime: new Date(baseTime + t * 1000),
        accuracyMeters: acc,
        speedMps: speed,
        speedAccuracyMps: speed === null ? null : 0.5,
        headingDegrees: heading,
      });
    for (let t = 0; t < 20; t++) push(t, lat0 + (5 * t) / M_LAT, 5, 5, 0);
    // bad fixes: 5 m/s northwards with +-40 m alternating scatter
    let sumLat = 0;
    let n = 0;
    for (let t = 20; t < 50; t += 2) {
      const lat = lat0 + (5 * t + (n % 2 === 0 ? 40 : -40)) / M_LAT;
      push(t, lat, badAccuracyM, 5, 0);
      sumLat += lat;
      n++;
    }
    for (let t = 50; t < 70; t++) push(t, lat0 + (5 * t) / M_LAT, 5, 5, 0);
    return { points, badCentre: [sumLat / n, lon0] };
  }

  it("'average' mode (default) replaces low-accuracy runs with their average centre instead of dropping them", async () => {
    const { points } = trace(60);
    const ctx = await new TripProcessor({ skipPersist: true, skipPublish: true }).processTrip('acc-1', points);
    const averaged = ctx.filteredPoints!.filter((p) => p.averagedCount);
    // 15 bad fixes over 28 s, lowAccuracyWindowS = 20 s -> 2 averaged points
    expect(averaged.length).toBe(2);
    expect(averaged.reduce((a, p) => a + p.averagedCount!, 0)).toBe(15);
    for (const p of averaged) {
      // the +-40 m scatter cancels out: the centre lies on the true track (lat0 + 5 m/s * t)
      const tRel = (p.deviceTime.getTime() - baseTime) / 1000;
      const trueLat = 12.9716 + (5 * tRel) / M_LAT;
      expect(Math.abs(p.latitude - trueLat) * M_LAT).toBeLessThan(5);
      expect(p.headingDegrees).toBeNull();
    }
    // no hole: one continuous chunk, and the averaged points are flagged downstream
    expect(ctx.chunks!.length).toBe(1);
    expect(ctx.smoothedPoints!.filter((p) => p.flags.includes('accuracy_averaged')).length).toBe(2);
  });

  it("'drop' mode keeps the old behaviour; fixes worse than lowAccuracyMaxM are always dropped", async () => {
    const { points } = trace(60);
    const dropped = await new TripProcessor({
      config: loadPipelineConfig({ lowAccuracyMode: 'drop' }),
      skipPersist: true,
      skipPublish: true,
    }).processTrip('acc-2', points);
    expect(dropped.filteredPoints!.length).toBe(40);
    // the 31 s hole (t=19 -> t=50) exceeds gapSplitS, so dropping breaks the path in two
    expect(dropped.chunks!.length).toBe(2);

    const terrible = await new TripProcessor({ skipPersist: true, skipPublish: true }).processTrip(
      'acc-3',
      trace(500).points
    );
    expect(terrible.filteredPoints!.some((p) => p.averagedCount)).toBe(false);
    expect(terrible.filteredPoints!.length).toBe(40);
  });
});

describe('Forward Kalman estimate is kept alongside RTS', () => {
  it('each smoothed point carries kfLatitude/kfLongitude/kfSigmaM; last point equals RTS', async () => {
    const points: RawPoint[] = [];
    const baseTime = new Date('2026-03-01T18:00:00Z').getTime();
    for (let i = 0; i < 60; i++) {
      points.push({
        id: i + 1,
        latitude: 12.9716 + (6 * i + (i % 2 === 0 ? 4 : -4)) / 110574,
        longitude: 77.5946,
        deviceTime: new Date(baseTime + i * 1000),
        accuracyMeters: 8,
        speedMps: 6,
        speedAccuracyMps: 0.5,
        headingDegrees: 0,
      });
    }
    const ctx = await new TripProcessor({ skipPersist: true, skipPublish: true }).processTrip('kf-1', points);
    const sp = ctx.smoothedPoints!;
    expect(sp.every((p) => Number.isFinite(p.kfLatitude) && Number.isFinite(p.kfLongitude) && p.kfSigmaM! > 0)).toBe(true);
    // RTS starts from the last forward estimate, so they coincide at the end of a chunk...
    const last = sp[sp.length - 1];
    expect(last.kfLatitude).toBeCloseTo(last.latitude, 9);
    // ...while RTS (using future fixes too) is never less certain than the forward filter
    expect(sp.every((p) => p.sigmaM <= p.kfSigmaM! + 1e-6)).toBe(true);
    expect(sp.some((p) => Math.abs(p.kfLatitude! - p.latitude) * 110574 > 0.1)).toBe(true);
  });
});
