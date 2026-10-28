import 'dotenv/config';
import { Command } from 'commander';
import prisma from '../db/prisma.js';
import { jobQueue } from '../tripProcessing/queue/jobQueue.js';
import logger from '../logger.js';

const program = new Command();

program
  .name('trip-reprocessor')
  .description('CLI to enqueue trips for offline path smoothing and distance reprocessing')
  .version('1.0.0');

program
  .command('reprocess-trip <tripId>')
  .description('Enqueue a single trip for reprocessing')
  .option('-v, --version <version>', 'Pipeline version to process with', 'v1.0.0')
  .action(async (tripId: string, options: { version: string }) => {
    try {
      const trip = await prisma.trip.findUnique({
        where: { tripId },
      });
      if (!trip) {
        console.error(`Error: Trip '${tripId}' does not exist in database.`);
        process.exit(1);
      }

      const jobId = await jobQueue.enqueueJob(tripId, options.version);
      console.log(`Successfully enqueued trip '${tripId}' as job #${jobId} (pipeline: ${options.version})`);
      process.exit(0);
    } catch (err: any) {
      console.error(`Failed to enqueue trip:`, err?.message);
      process.exit(1);
    }
  });

program
  .command('reprocess-range')
  .description('Enqueue all trips within a date range for reprocessing')
  .requiredOption('--from <from>', 'Start date/timestamp (ISO-8601 or YYYY-MM-DD)')
  .requiredOption('--to <to>', 'End date/timestamp (ISO-8601 or YYYY-MM-DD)')
  .option('-v, --version <version>', 'Pipeline version to process with', 'v1.0.0')
  .action(async (options: { from: string; to: string; version: string }) => {
    try {
      const fromDate = new Date(options.from);
      const toDate = new Date(options.to);

      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        console.error('Error: Invalid --from or --to datetime provided.');
        process.exit(1);
      }

      const trips = await prisma.trip.findMany({
        where: {
          createdAt: {
            gte: fromDate,
            lte: toDate,
          },
        },
        select: { tripId: true },
      });

      console.log(`Found ${trips.length} trips between ${options.from} and ${options.to}.`);

      let enqueued = 0;
      for (const t of trips) {
        await jobQueue.enqueueJob(t.tripId, options.version);
        enqueued++;
      }

      console.log(`Successfully enqueued ${enqueued} trips for reprocessing.`);
      process.exit(0);
    } catch (err: any) {
      console.error('Failed to enqueue range:', err?.message);
      process.exit(1);
    }
  });

program.parse(process.argv);
