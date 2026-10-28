import { describe, it, expect } from 'vitest';
import prisma from '../../src/db/prisma.js';
import { TripProcessor } from '../../src/tripProcessing/TripProcessor.js';
import { NoopMatcher } from '../../src/tripProcessing/stages/6_matching.js';
import { jobQueue } from '../../src/tripProcessing/queue/jobQueue.js';
import type { RawPoint } from '../../src/tripProcessing/types.js';

describe('Matcher, Idempotency, and Job Queue Tests', () => {
  it('NoopMatcher test: completes cleanly when matching disabled, and enabled with NoopMatcher', async () => {
    const baseTime = new Date('2026-03-01T20:00:00Z').getTime();
    const points: RawPoint[] = [];

    for (let i = 0; i < 30; i++) {
      points.push({
        id: i + 1,
        latitude: 12.9716 + i * 0.0001,
        longitude: 77.5946 + i * 0.0001,
        deviceTime: new Date(baseTime + i * 2000),
        accuracyMeters: 5.0,
        speedMps: 8.0,
        speedAccuracyMps: 0.5,
        headingDegrees: 45.0,
      });
    }

    // 1. Pipeline with map matching disabled
    const processorDisabled = new TripProcessor({
      config: {
        pipelineVersion: 'v1.0.0',
        gapSplitS: 30,
        stopRadiusM: 25,
        stopMinDwellS: 90,
        stopSpeedMps: 1.0,
        tortuosityMin: 3,
        exitRadiusM: 40,
        exitSpeedMps: 2.0,
        kfQ: 1.5,
        minSigmaM: 3.0,
        chi2Gate: 9.21,
        maxConsecutiveRejects: 5,
        mapMatching: { enabled: false },
        mmTriggerPct: 3,
        mmMinKm: 0.1,
        maxAccuracyM: 30,
        maxSpeedKph: 100,
      },
      skipPersist: true,
      skipPublish: true,
    });

    const ctxDisabled = await processorDisabled.processTrip('trip-mm-disabled', points);
    expect(ctxDisabled.matchedSegments).toBeUndefined();

    // 2. Pipeline with map matching enabled and NoopMatcher
    const processorEnabled = new TripProcessor({
      config: {
        pipelineVersion: 'v1.0.0',
        gapSplitS: 30,
        stopRadiusM: 25,
        stopMinDwellS: 90,
        stopSpeedMps: 1.0,
        tortuosityMin: 3,
        exitRadiusM: 40,
        exitSpeedMps: 2.0,
        kfQ: 1.5,
        minSigmaM: 3.0,
        chi2Gate: 9.21,
        maxConsecutiveRejects: 5,
        mapMatching: { enabled: true },
        mmTriggerPct: 3,
        mmMinKm: 0.05,
        maxAccuracyM: 30,
        maxSpeedKph: 100,
      },
      matcher: new NoopMatcher(),
      skipPersist: true,
      skipPublish: true,
    });

    // Provide odometer discrepancy to trigger map matching
    const ctxEnabled = await processorEnabled.processTrip('trip-mm-enabled', points, {
      odometerStartKm: 100.0,
      odometerEndKm: 100.8, // 800m vs ~400m smoothed
    });

    expect(ctxEnabled.diagnostics?.triggerReason).toContain('ODOMETER_DISCREPANCY');
    expect(ctxEnabled.matchedSegments).toBeDefined();
    expect(ctxEnabled.matchedSegments!.length).toBeGreaterThan(0);
    expect(ctxEnabled.matchedSegments![0].segmentType).toBe('unmatched');
  });

  it('idempotency test: processing a trip twice yields identical persisted counts and values', async () => {
    const testTripId = `idempotent-test-${Date.now()}`;
    const baseTime = new Date('2026-03-01T21:00:00Z').getTime();

    // Setup Trip record in DB for foreign key constraint
    await prisma.trip.create({
      data: {
        tripId: testTripId,
        status: 'Completed',
        deviceKey: {
          connectOrCreate: {
            where: { deviceId: 'test-device-idemp' },
            create: { deviceId: 'test-device-idemp' },
          },
        },
      },
    });

    const points: RawPoint[] = [];
    for (let i = 0; i < 20; i++) {
      points.push({
        id: i + 1,
        latitude: 12.9716 + i * 0.0001,
        longitude: 77.5946 + i * 0.0001,
        deviceTime: new Date(baseTime + i * 2000),
        accuracyMeters: 5.0,
        speedMps: 5.0,
        speedAccuracyMps: 0.5,
        headingDegrees: 45.0,
      });
    }

    const processor = new TripProcessor({ skipPublish: true });

    // Run 1
    const ctx1 = await processor.processTrip(testTripId, points);
    const summary1 = await prisma.tripDistanceSummary.findUnique({
      where: { tripId: testTripId },
    });
    const pointsCount1 = await prisma.tripProcessedPoint.count({
      where: { tripId: testTripId },
    });

    // Run 2 (reprocessing)
    const ctx2 = await processor.processTrip(testTripId, points);
    const summary2 = await prisma.tripDistanceSummary.findUnique({
      where: { tripId: testTripId },
    });
    const pointsCount2 = await prisma.tripProcessedPoint.count({
      where: { tripId: testTripId },
    });

    expect(summary1?.distanceFinalM).toBe(summary2?.distanceFinalM);
    expect(summary1?.distanceSmoothedM).toBe(summary2?.distanceSmoothedM);
    expect(pointsCount1).toBe(pointsCount2);
    expect(ctx1.distances?.distanceFinalM).toBe(ctx2.distances?.distanceFinalM);

    // Clean up
    await prisma.trip.delete({ where: { tripId: testTripId } });
  });

  it('job test: trip-end enqueues a job and returns immediately without running synchronous processing', async () => {
    const tripId = `job-test-trip-${Date.now()}`;

    // Enqueue job via JobQueue
    const jobId = await jobQueue.enqueueJob(tripId, 'v1.0.0');
    expect(jobId).toBeGreaterThan(0);

    // Query job table to verify pending status
    const job = await prisma.tripProcessingJob.findUnique({
      where: { id: jobId },
    });

    expect(job).toBeDefined();
    expect(job!.tripId).toBe(tripId);
    expect(job!.status).toBe('pending');
    expect(job!.attempts).toBe(0);

    // Clean up
    await prisma.tripProcessingJob.delete({ where: { id: jobId } });
  });
});
