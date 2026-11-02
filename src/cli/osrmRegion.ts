import 'dotenv/config';
import fs from 'node:fs';
import { Command } from 'commander';
import prisma from '../db/prisma.js';
import { OsrmRegionRepository, type RegionKind } from '../tripProcessing/matching/regionRegistry.js';

/**
 * Manage the OSRM region registry.
 *
 *   npm run osrm-region -- add --id blr --geojson ./blr.geojson --url http://osrm-blr:5000 \
 *       --profile car --kind hotspot --data-version 2026-10-01 [--name "Bengaluru"]
 *   npm run osrm-region -- list
 *   npm run osrm-region -- disable blr
 */
const repo = new OsrmRegionRepository();
const program = new Command();

program.name('osrm-region').description('Manage OSRM regions used by the regional map matcher');

async function run(fn: () => Promise<void>) {
  try {
    await fn();
    await prisma.$disconnect();
    process.exit(0);
  } catch (err: any) {
    console.error(`Error: ${err?.message ?? err}`);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  }
}

program
  .command('add')
  .description('Register (or replace) a region')
  .requiredOption('--id <id>', 'region id')
  .requiredOption('--geojson <file>', 'GeoJSON file: Polygon/MultiPolygon geometry, Feature, or 1-feature FeatureCollection')
  .requiredOption('--url <url>', 'OSRM base URL, e.g. http://osrm-blr:5000')
  .requiredOption('--profile <profile>', 'OSRM profile (car | bike | custom name)')
  .requiredOption('--kind <kind>', 'hotspot | backbone')
  .requiredOption('--data-version <version>', 'OSM extract / dataset version served by this instance')
  .option('--name <name>', 'display name (defaults to id)')
  .action((opts) =>
    run(async () => {
      const polygon = JSON.parse(fs.readFileSync(opts.geojson, 'utf8'));
      const r = await repo.register({
        regionId: opts.id,
        name: opts.name,
        polygon,
        osrmUrl: opts.url,
        profile: opts.profile,
        kind: opts.kind as RegionKind,
        dataVersion: opts.dataVersion,
      });
      console.log(
        `Registered region '${r.regionId}' (${r.kind}, ${r.profile}) -> ${r.osrmUrl} ` +
          `bbox=[${r.minLon},${r.minLat},${r.maxLon},${r.maxLat}] data_version=${r.dataVersion}`
      );
    })
  );

program
  .command('list')
  .description('List all regions')
  .action(() =>
    run(async () => {
      const regions = await repo.listAll();
      if (regions.length === 0) {
        console.log('No regions registered.');
        return;
      }
      console.table(
        regions.map((r) => ({
          id: r.regionId,
          name: r.name,
          kind: r.kind,
          profile: r.profile,
          url: r.osrmUrl,
          data_version: r.dataVersion,
          enabled: r.enabled,
          bbox: `${r.minLon.toFixed(3)},${r.minLat.toFixed(3)},${r.maxLon.toFixed(3)},${r.maxLat.toFixed(3)}`,
        }))
      );
    })
  );

program
  .command('disable <id>')
  .description('Disable a region (it is skipped by the matcher after the cache TTL)')
  .action((id: string) =>
    run(async () => {
      const ok = await repo.disable(id);
      if (!ok) throw new Error(`region '${id}' not found`);
      console.log(`Disabled region '${id}'.`);
    })
  );

program.parse(process.argv);
