import { describe, it, expect } from 'vitest';
import { TripProcessor } from '../../src/tripProcessing/TripProcessor.js';
import type { RawPoint } from '../../src/tripProcessing/types.js';

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
  });
});
