import 'dotenv/config';
import prisma from '../../db/prisma.js';
import logger from '../../logger.js';
import { jobQueue, type JobRecord } from '../queue/jobQueue.js';
import { TripProcessor } from '../TripProcessor.js';
import type { RawPoint, PremiseGeofenceData } from '../types.js';

export class TripProcessingWorker {
  private isRunning = false;
  private readonly workerId: string;
  private readonly processor: TripProcessor;

  constructor(workerId?: string) {
    this.workerId = workerId ?? `worker-${process.pid}-${Date.now()}`;
    this.processor = new TripProcessor();
  }

  /**
   * Processes a single job payload.
   */
  async processJob(job: JobRecord): Promise<void> {
    const { trip_id: tripId, id: jobId, attempts, max_attempts: maxAttempts } = job;

    try {
      logger.info(`Worker ${this.workerId} processing job #${jobId} for trip ${tripId}`);

      // 1. Fetch raw coordinates from Postgres
      const coordinates = await prisma.coordinate.findMany({
        where: {
          tripId,
          hasGps: true,
          latitude: { not: null },
          longitude: { not: null },
        },
        orderBy: [{ deviceTime: 'asc' }, { id: 'asc' }],
      });

      // 2. Fetch trip metadata
      const trip = await prisma.trip.findUnique({
        where: { tripId },
        select: {
          odometerStartKm: true,
          odometerEndKm: true,
        },
      });

      // 3. Fetch premise geofences
      const geofenceRows = await prisma.premiseGeofence.findMany();
      const premiseGeofences: PremiseGeofenceData[] = geofenceRows.map((g) => ({
        id: g.id,
        name: g.name,
        polygon: g.polygon,
        minLat: g.minLat,
        minLon: g.minLon,
        maxLat: g.maxLat,
        maxLon: g.maxLon,
      }));

      // 4. Map DB coordinates to RawPoint domain model
      const rawPoints: RawPoint[] = coordinates.map((c) => ({
        id: c.id,
        latitude: c.latitude!,
        longitude: c.longitude!,
        deviceTime: c.deviceTime,
        accuracyMeters: c.accuracyMeters,
        speedMps:
          c.speedMps !== null
            ? c.speedMps
            : c.speedKph !== null
            ? c.speedKph / 3.6
            : null,
        speedAccuracyMps: c.speedAccuracyMps,
        headingDegrees: c.headingDegrees,
        isMock: c.isMock,
      }));

      // 5. Run TripProcessor pipeline
      await this.processor.processTrip(tripId, rawPoints, {
        odometerStartKm: trip?.odometerStartKm,
        odometerEndKm: trip?.odometerEndKm,
        premiseGeofences,
      });

      // 6. Complete job
      await jobQueue.completeJob(jobId);
      logger.info(`Worker ${this.workerId} finished job #${jobId} for trip ${tripId}`);
    } catch (err: any) {
      const errorMsg = err?.message ?? String(err);
      logger.error(`Worker ${this.workerId} failed on job #${jobId} for trip ${tripId}`, {
        error: errorMsg,
        stack: err?.stack,
      });
      await jobQueue.failJob(jobId, errorMsg, attempts, maxAttempts);
    }
  }

  /**
   * Starts the polling loop.
   */
  async start(pollIntervalMs = 2000): Promise<void> {
    this.isRunning = true;
    logger.info(`TripProcessingWorker ${this.workerId} started polling`);

    while (this.isRunning) {
      try {
        const job = await jobQueue.dequeueJob(this.workerId);
        if (job) {
          await this.processJob(job);
        } else {
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
        }
      } catch (err: any) {
        logger.error(`TripProcessingWorker error during polling`, {
          error: err?.message,
        });
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  }

  stop(): void {
    this.isRunning = false;
    logger.info(`TripProcessingWorker ${this.workerId} stopping`);
  }
}

// Direct execution entrypoint
if (process.argv[1] && process.argv[1].endsWith('worker.ts') || process.argv[1]?.endsWith('worker.js')) {
  const worker = new TripProcessingWorker();
  worker.start().catch((err) => {
    logger.error('Fatal worker error', { error: err?.message });
    process.exit(1);
  });

  const handleShutdown = () => {
    worker.stop();
    process.exit(0);
  };
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}
