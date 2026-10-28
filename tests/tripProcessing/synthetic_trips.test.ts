import { describe, it, expect } from 'vitest';
import { TripProcessor } from '../../src/tripProcessing/TripProcessor.js';
import type { RawPoint } from '../../src/tripProcessing/types.js';

// Deterministic pseudo-random number generator for reproducibility
function pseudoRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Box-Muller transform for deterministic Gaussian noise
function gaussianNoise(rng: () => number, sigma: number): number {
  const u1 = Math.max(1e-10, rng());
  const u2 = rng();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * sigma;
}

describe('Synthetic Noisy Trip Smoothing Tests', () => {
  it('straight trip with 10m Gaussian noise: smoothed distance error < 2% and raw is visibly worse', async () => {
    const rng = pseudoRandom(12345);
    const startLat = 12.9716;
    const startLon = 77.5946;
    const speedMps = 10.0;
    const dt = 2.0;
    const numPoints = 100; // 200s, true distance = 10 m/s * 198s = 1980m

    const trueDistanceM = speedMps * (numPoints - 1) * dt;
    const metersPerDegLat = 110574;
    const metersPerDegLon = 111320 * Math.cos((startLat * Math.PI) / 180);

    const points: RawPoint[] = [];
    const baseTime = new Date('2026-03-01T08:00:00Z').getTime();

    for (let i = 0; i < numPoints; i++) {
      const trueDistM = speedMps * i * dt;
      // Add Gaussian noise (sigma 10m) in North and East directions
      const noiseEastM = gaussianNoise(rng, 10.0);
      const noiseNorthM = gaussianNoise(rng, 10.0);

      const lat = startLat + (noiseNorthM) / metersPerDegLat;
      const lon = startLon + (trueDistM + noiseEastM) / metersPerDegLon;

      points.push({
        id: i + 1,
        latitude: lat,
        longitude: lon,
        deviceTime: new Date(baseTime + i * dt * 1000),
        accuracyMeters: 10.0,
        speedMps,
        speedAccuracyMps: 1.0,
        headingDegrees: 90.0,
      });
    }

    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const ctx = await processor.processTrip('noisy-straight-1', points);

    const rawDistanceM = ctx.distances!.distanceRawFilteredM;
    const smoothedDistanceM = ctx.distances!.distanceSmoothedM;

    // Smoothed distance error must be < 2%
    const smoothedErrorPct = (Math.abs(smoothedDistanceM - trueDistanceM) / trueDistanceM) * 100;
    const rawErrorPct = (Math.abs(rawDistanceM - trueDistanceM) / trueDistanceM) * 100;

    expect(smoothedErrorPct).toBeLessThan(2.0);
    // Zigzag causes raw summed distance to be visibly worse (> 15% error)
    expect(rawErrorPct).toBeGreaterThan(15.0);
    expect(rawDistanceM).toBeGreaterThan(smoothedDistanceM + 200);
  });

  it('curved trip with 8m Gaussian noise: smoothed distance error < 2% and raw is visibly worse', async () => {
    const rng = pseudoRandom(67890);
    const centerLat = 12.9716;
    const centerLon = 77.5946;
    const radiusM = 600.0;
    const arcRad = Math.PI; // Half-circle
    const numPoints = 80;
    const dt = 2.0;

    const trueDistanceM = radiusM * arcRad; // ~1884.9m
    const metersPerDegLat = 110574;
    const metersPerDegLon = 111320 * Math.cos((centerLat * Math.PI) / 180);

    const points: RawPoint[] = [];
    const baseTime = new Date('2026-03-01T09:00:00Z').getTime();

    for (let i = 0; i < numPoints; i++) {
      const angle = (i / (numPoints - 1)) * arcRad;
      const trueEastM = radiusM * Math.cos(angle);
      const trueNorthM = radiusM * Math.sin(angle);

      const noiseEastM = gaussianNoise(rng, 8.0);
      const noiseNorthM = gaussianNoise(rng, 8.0);

      const lat = centerLat + (trueNorthM + noiseNorthM) / metersPerDegLat;
      const lon = centerLon + (trueEastM + noiseEastM) / metersPerDegLon;

      const vx = -Math.sin(angle);
      const vy = Math.cos(angle);
      let tangentHeading = (Math.atan2(vx, vy) * 180) / Math.PI;
      if (tangentHeading < 0) tangentHeading += 360;

      points.push({
        id: i + 1,
        latitude: lat,
        longitude: lon,
        deviceTime: new Date(baseTime + i * dt * 1000),
        accuracyMeters: 8.0,
        speedMps: trueDistanceM / (numPoints * dt),
        speedAccuracyMps: 1.0,
        headingDegrees: tangentHeading,
      });
    }

    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const ctx = await processor.processTrip('noisy-curve-1', points);

    const rawDistanceM = ctx.distances!.distanceRawFilteredM;
    const smoothedDistanceM = ctx.distances!.distanceSmoothedM;

    const smoothedErrorPct = (Math.abs(smoothedDistanceM - trueDistanceM) / trueDistanceM) * 100;
    const rawErrorPct = (Math.abs(rawDistanceM - trueDistanceM) / trueDistanceM) * 100;

    expect(smoothedErrorPct).toBeLessThan(2.0);
    expect(rawErrorPct).toBeGreaterThan(10.0);
    expect(rawDistanceM).toBeGreaterThan(smoothedDistanceM + 150);
  });
});
