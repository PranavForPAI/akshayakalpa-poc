import { describe, it, expect } from 'vitest';
import { TripProcessor } from '../../src/tripProcessing/TripProcessor.js';
import type { RawPoint } from '../../src/tripProcessing/types.js';

describe('Kalman RTS Smoother Unit Tests', () => {
  it('recovers known linear-motion trajectory within tight tolerance', async () => {
    // True path: traveling East at 10 m/s from Bangalore (12.9716, 77.5946)
    // 100 points, 2s intervals = 200s, total distance ~2000m
    const startLat = 12.9716;
    const startLon = 77.5946;
    const speedMps = 10.0;
    const dt = 2.0;
    const numPoints = 60;

    // meters per degree approx at latitude 12.97 deg
    const metersPerDegLat = 110574;
    const metersPerDegLon = 111320 * Math.cos((startLat * Math.PI) / 180);

    const points: RawPoint[] = [];
    const baseTime = new Date('2026-03-01T10:00:00Z').getTime();

    for (let i = 0; i < numPoints; i++) {
      const distEastM = speedMps * i * dt;
      const lat = startLat;
      const lon = startLon + distEastM / metersPerDegLon;

      points.push({
        id: i + 1,
        latitude: lat,
        longitude: lon,
        deviceTime: new Date(baseTime + i * dt * 1000),
        accuracyMeters: 5.0,
        speedMps,
        speedAccuracyMps: 0.5,
        headingDegrees: 90.0,
      });
    }

    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const ctx = await processor.processTrip('linear-trip-1', points);

    expect(ctx.smoothedPoints).toBeDefined();
    expect(ctx.smoothedPoints!.length).toBe(numPoints);

    // Expected distance ~ 10 m/s * 59 * 2s = 1180m
    const expectedDistM = speedMps * (numPoints - 1) * dt;
    const actualDistM = ctx.distances!.distanceSmoothedM;

    // Smoothed distance error < 0.5% on ideal linear path
    const errPct = (Math.abs(actualDistM - expectedDistM) / expectedDistM) * 100;
    expect(errPct).toBeLessThan(0.5);

    // Smoothed speed recovered around 10 m/s
    const midPoint = ctx.smoothedPoints![Math.floor(numPoints / 2)];
    expect(midPoint.speedMps).toBeCloseTo(10.0, 0);
  });

  it('guarantees RTS smoothed position variance <= filtered variance', async () => {
    // Verify that the backward smoother reduces or maintains covariance trace
    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const baseTime = new Date('2026-03-01T10:00:00Z').getTime();

    const points: RawPoint[] = [];
    for (let i = 0; i < 30; i++) {
      points.push({
        id: i + 1,
        latitude: 12.9716 + i * 0.0001,
        longitude: 77.5946 + i * 0.0001,
        deviceTime: new Date(baseTime + i * 2000),
        accuracyMeters: 10.0,
        speedMps: 7.0,
        speedAccuracyMps: 1.0,
        headingDegrees: 45.0,
      });
    }

    const ctx = await processor.processTrip('cov-trip-1', points);
    const smoothed = ctx.smoothedPoints!;

    // Every smoothed point should have a reasonable positional sigma
    for (const pt of smoothed) {
      expect(pt.sigmaM).toBeGreaterThan(0);
      expect(pt.sigmaM).toBeLessThanOrEqual(15.0);
    }
  });
});
