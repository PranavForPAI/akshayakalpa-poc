/**
 * Regenerates tests/tripProcessing/fixtures/matching_disabled_golden.json.
 * The committed fixture was generated from the pipeline BEFORE the regional OSRM matcher was
 * added; only regenerate it deliberately when pipeline outputs are meant to change.
 *
 *   npx tsx tests/tripProcessing/helpers/generateGolden.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { TripProcessor } from '../../../src/tripProcessing/TripProcessor.js';
import { loadPipelineConfig } from '../../../src/tripProcessing/config.js';
import { buildStopAndGoTrace, canonicalPipelineOutput } from './syntheticTrace.js';

async function main() {
  const processor = new TripProcessor({
    config: loadPipelineConfig({ mapMatching: { enabled: false } as any }),
    skipPersist: true,
    skipPublish: true,
  });
  const ctx = await processor.processTrip('golden-trip', buildStopAndGoTrace(), {
    odometerStartKm: 100,
    odometerEndKm: 103,
  });
  const out = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/(\w:)/, '$1')), '..', 'fixtures', 'matching_disabled_golden.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(canonicalPipelineOutput(ctx), null, 2));
  console.log('wrote', out, 'distanceFinalM', ctx.distances?.distanceFinalM, 'stops', ctx.stops?.length, 'chunks', ctx.chunks?.length);
  process.exit(0);
}
main();
