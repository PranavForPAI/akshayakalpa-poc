import 'dotenv/config';
import logger from '../../logger.js';
import { jobQueue, type JobRecord } from '../queue/jobQueue.js';
import { TripProcessor } from '../TripProcessor.js';
import { loadTripInput } from '../loadTrip.js';

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

      // 1. Load coordinates, odometer readings and premise geofences
      const { rawPoints, metadata } = await loadTripInput(tripId);

      // 2. Run TripProcessor pipeline
      await this.processor.processTrip(tripId, rawPoints, metadata);

      // 3. Complete job
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
