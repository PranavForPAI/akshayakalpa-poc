import prisma from '../../db/prisma.js';
import logger from '../../logger.js';

export interface JobRecord {
  id: number;
  trip_id: string;
  pipeline_version: string;
  attempts: number;
  max_attempts: number;
}

export class JobQueue {
  /**
   * Enqueues a trip for asynchronous processing.
   * If a pending or processing job already exists for the trip, refreshes run_at.
   */
  async enqueueJob(tripId: string, pipelineVersion = 'v1.0.0'): Promise<number> {
    const existing = await prisma.tripProcessingJob.findFirst({
      where: {
        tripId,
        pipelineVersion,
        status: { in: ['pending', 'processing'] },
      },
    });

    if (existing) {
      await prisma.tripProcessingJob.update({
        where: { id: existing.id },
        data: {
          runAt: new Date(),
          status: 'pending',
          attempts: 0,
        },
      });
      logger.info(`JobQueue: updated existing job #${existing.id} for trip ${tripId}`);
      return existing.id;
    }

    const created = await prisma.tripProcessingJob.create({
      data: {
        tripId,
        pipelineVersion,
        status: 'pending',
        runAt: new Date(),
        attempts: 0,
      },
    });

    logger.info(`JobQueue: enqueued job #${created.id} for trip ${tripId}`);
    return created.id;
  }

  /**
   * Atomically dequeues the next eligible job using PostgreSQL `FOR UPDATE SKIP LOCKED`.
   */
  async dequeueJob(workerId: string): Promise<JobRecord | null> {
    return await prisma.$transaction(async (tx) => {
      const rows: JobRecord[] = await tx.$queryRaw`
        SELECT id, trip_id, pipeline_version, attempts, max_attempts
        FROM trip_processing_jobs
        WHERE status = 'pending' AND run_at <= NOW()
        ORDER BY run_at ASC, id ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED;
      `;

      if (!rows || rows.length === 0) {
        return null;
      }

      const job = rows[0];
      await tx.$executeRaw`
        UPDATE trip_processing_jobs
        SET status = 'processing',
            locked_at = NOW(),
            locked_by = ${workerId},
            updated_at = NOW()
        WHERE id = ${job.id};
      `;

      return job;
    });
  }

  /**
   * Marks a job as successfully completed.
   */
  async completeJob(jobId: number): Promise<void> {
    await prisma.tripProcessingJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        lockedAt: null,
        lockedBy: null,
        error: null,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Handles job failure with exponential backoff and dead-letter routing.
   */
  async failJob(
    jobId: number,
    error: string,
    currentAttempts: number,
    maxAttempts: number
  ): Promise<void> {
    const nextAttempts = currentAttempts + 1;
    if (nextAttempts >= maxAttempts) {
      logger.error(`JobQueue: Job #${jobId} moved to DEAD_LETTER after ${nextAttempts} attempts`, {
        jobId,
        error,
      });
      await prisma.tripProcessingJob.update({
        where: { id: jobId },
        data: {
          status: 'dead_letter',
          attempts: nextAttempts,
          lockedAt: null,
          lockedBy: null,
          error,
          updatedAt: new Date(),
        },
      });
      return;
    }

    // Exponential backoff: 2s, 4s, 8s...
    const backoffDelayMs = Math.pow(2, nextAttempts) * 1000;
    const nextRunAt = new Date(Date.now() + backoffDelayMs);

    logger.warn(`JobQueue: Job #${jobId} failed; scheduled retry at ${nextRunAt.toISOString()}`, {
      jobId,
      attempt: nextAttempts,
      maxAttempts,
      error,
    });

    await prisma.tripProcessingJob.update({
      where: { id: jobId },
      data: {
        status: 'pending',
        attempts: nextAttempts,
        runAt: nextRunAt,
        lockedAt: null,
        lockedBy: null,
        error,
        updatedAt: new Date(),
      },
    });
  }
}

export const jobQueue = new JobQueue();
