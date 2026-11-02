import 'dotenv/config';
import { Command } from 'commander';
import prisma from '../db/prisma.js';
import { loadPipelineConfig } from '../tripProcessing/config.js';
import { TripProcessor } from '../tripProcessing/TripProcessor.js';
import { loadTripInput } from '../tripProcessing/loadTrip.js';
import { createMatcher, OsrmRegionRepository } from '../tripProcessing/matching/index.js';

/**
 * Runs the full pipeline for ONE trip in-process with regional OSRM map matching forced on,
 * regardless of the odometer-discrepancy trigger. Intended for local testing / debugging.
 *
 *   npm run match-trip -- TRIP-2026-00047              # persist results, no upstream publish
 *   npm run match-trip -- TRIP-2026-00047 --dry-run    # print only, write nothing
 *   npm run match-trip -- TRIP-2026-00047 --publish    # also publish to the upstream service
 */
const program = new Command();

program
  .name('match-trip')
  .description('Run the pipeline for one trip with regional OSRM map matching forced on')
  .argument('<tripId>', 'trip id, e.g. TRIP-2026-00047')
  .option('--dry-run', 'do not persist results (print only)', false)
  .option('--publish', 'publish the processed summary upstream (off by default)', false)
  .option('--segments', 'print every matched/unmatched segment', false)
  .action(async (tripId: string, opts: { dryRun: boolean; publish: boolean; segments: boolean }) => {
    let exitCode = 0;
    try {
      exitCode = await run(tripId, opts);
    } catch (err: any) {
      console.error(`Error: ${err?.message ?? err}`);
      exitCode = 1;
    }
    await prisma.$disconnect().catch(() => undefined);
    process.exit(exitCode);
  });

async function run(tripId: string, opts: { dryRun: boolean; publish: boolean; segments: boolean }): Promise<number> {
  const input = await loadTripInput(tripId);
  if (!input.tripExists) {
    console.error(`Error: trip '${tripId}' does not exist.`);
    return 1;
  }
  if (input.rawPoints.length < 2) {
    console.error(`Error: trip '${tripId}' has ${input.rawPoints.length} GPS point(s); nothing to process.`);
    return 1;
  }

  const regions = await new OsrmRegionRepository().listEnabled();
  if (regions.length === 0) {
    console.warn(
      'Warning: no enabled OSRM regions. Register one with `npm run osrm-region -- add ...`; ' +
        'every segment will be unmatched (no_region_coverage).'
    );
  } else {
    console.log(`Enabled OSRM regions: ${regions.map((r) => `${r.regionId} (${r.kind}, ${r.osrmUrl})`).join(', ')}`);
  }

  const base = loadPipelineConfig();
  const config = loadPipelineConfig({
    mapMatching: { ...base.mapMatching, enabled: true, backend: 'osrm_regional' },
  });
  const processor = new TripProcessor({
    config,
    matcher: createMatcher(config),
    forceMatching: true,
    skipPersist: opts.dryRun,
    skipPublish: !opts.publish,
  });

  console.log(`Processing ${tripId}: ${input.rawPoints.length} GPS points...`);
  const ctx = await processor.processTrip(tripId, input.rawPoints, input.metadata);
  const d = ctx.distances;
  const s = ctx.matchingSummary;

  console.log('\n=== Distance ===');
  console.table({
    smoothed_m: d?.distanceSmoothedM,
    final_m: d?.distanceFinalM,
    raw_filtered_m: d?.distanceRawFilteredM,
    odometer_m: d?.distanceOdometerM ?? 'n/a',
    trigger_reason: d?.triggerReason,
  });

  console.log('=== Matching ===');
  if (!s) {
    console.log('Matcher returned no summary.');
  } else {
    console.table({
      runs: s.nRuns,
      matched_segments: s.nMatched,
      unmatched_segments: s.nUnmatched,
      matched_share_pct: Math.round(s.matchedShare * 1000) / 10,
      regions_used: s.regionsUsed.join(', ') || '-',
      http_ms: s.httpMs,
    });
    if (Object.keys(s.rejectReasons).length > 0) {
      console.log('Reject / unmatched reasons:');
      console.table(s.rejectReasons);
    }
  }

  if (opts.segments && ctx.matchedSegments?.length) {
    console.log('=== Segments ===');
    console.table(
      ctx.matchedSegments.map((m) => ({
        chunk: m.chunkIndex,
        type: m.segmentType,
        region: m.regionId ?? '-',
        reason: m.rejectReason ?? '-',
        length_m: Math.round(m.lengthM),
        confidence: Math.round(m.confidence * 100) / 100,
        start: m.startTs?.toISOString().slice(11, 19),
        end: m.endTs?.toISOString().slice(11, 19),
      }))
    );
  }

  if (opts.dryRun) {
    console.log('\nDry run: nothing was written.');
  } else {
    console.log(`\nSaved (pipeline ${config.pipelineVersion}). View: GET /api/dashboard/trips/${tripId}/processed`);
  }
  if (!opts.publish) console.log('Upstream publish skipped (use --publish to send).');
  return 0;
}

program.parse(process.argv);
