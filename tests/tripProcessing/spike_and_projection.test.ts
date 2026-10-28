import { describe, it, expect } from 'vitest';
import { TripProcessor } from '../../src/tripProcessing/TripProcessor.js';
import { getUtmZone, getTransformer } from '../../src/tripProcessing/geo/projection.js';
import { haversineDistanceM } from '../../src/tripProcessing/geo/geodesic.js';
import type { RawPoint } from '../../src/tripProcessing/types.js';

describe('Spike Gating and Multi-Zone Projection Tests', () => {
  it('spike test: injected 80m spikes are gated, flagged and excluded from smoothing propagation', async () => {
    const baseLat = 12.9716;
    const baseLon = 77.5946;
    const baseTime = new Date('2026-03-01T18:00:00Z').getTime();

    const metersPerDegLat = 110574;
    const metersPerDegLon = 111320 * Math.cos((baseLat * Math.PI) / 180);

    const points: RawPoint[] = [];
    const numPoints = 25;
    const dt = 3.0; // 3s interval: 80m / 3s = 26.7 m/s (96 km/h < maxSpeedKph 100), passing Stage 1 into Kalman gating

    for (let i = 0; i < numPoints; i++) {
      let lat = baseLat;
      let lon = baseLon + (i * 20) / metersPerDegLon;

      // Inject 80m perpendicular North spike at index 12
      if (i === 12) {
        lat += 80 / metersPerDegLat;
      }

      points.push({
        id: i + 1,
        latitude: lat,
        longitude: lon,
        deviceTime: new Date(baseTime + i * dt * 1000),
        accuracyMeters: 5.0,
        speedMps: 6.67,
        speedAccuracyMps: 0.5,
        headingDegrees: 90.0,
      });
    }

    const processor = new TripProcessor({ skipPersist: true, skipPublish: true });
    const ctx = await processor.processTrip('spike-test-trip', points);

    // Point at index 12 must have 'rejected' flag
    const smoothedSpike = ctx.smoothedPoints!.find((p) => p.rawPointId === 13);
    expect(smoothedSpike).toBeDefined();
    expect(smoothedSpike!.flags).toContain('rejected');

    // The smoothed latitude of the spike point should NOT be shifted 80m into the spike
    // It should remain close to the base trajectory latitude (12.9716)
    const latShiftM = Math.abs(smoothedSpike!.latitude - baseLat) * metersPerDegLat;
    expect(latShiftM).toBeLessThan(15.0); // Smoother filtered out the 80m spike!
  });

  it('projection test: trips across diverse UTM zones (Surat, Delhi, Kolkata) yield consistent distances', () => {
    const cities = [
      { name: 'Surat', lat: 21.1702, lon: 72.8311, expectedZone: 43 },
      { name: 'Delhi', lat: 28.6139, lon: 77.2090, expectedZone: 43 },
      { name: 'Kolkata', lat: 22.5726, lon: 88.3639, expectedZone: 45 },
    ];

    for (const city of cities) {
      const zone = getUtmZone(city.lon);
      expect(zone).toBe(city.expectedZone);

      const transformer = getTransformer(zone);

      // Create a 1000m test segment traveling due East from the city center
      const metersPerDegLon = 111320 * Math.cos((city.lat * Math.PI) / 180);
      const endLon = city.lon + 1000.0 / metersPerDegLon;

      const [x1, y1] = transformer.forward(city.lon, city.lat);
      const [x2, y2] = transformer.forward(endLon, city.lat);

      // Euclidean distance in projected metric CRS
      const metricDist = Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
      // Haversine reference distance
      const haversineDist = haversineDistanceM(city.lat, city.lon, city.lat, endLon);

      // Metric projection distance matches haversine reference within 0.25%
      const diffPct = (Math.abs(metricDist - haversineDist) / haversineDist) * 100;
      expect(diffPct).toBeLessThan(0.25);

      // Verify inverse projection round-trip
      const [rtLon, rtLat] = transformer.inverse(x1, y1);
      expect(rtLon).toBeCloseTo(city.lon, 6);
      expect(rtLat).toBeCloseTo(city.lat, 6);
    }
  });
});
