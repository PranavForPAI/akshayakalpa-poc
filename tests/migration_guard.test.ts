import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GUARD = path.join(__dirname, '..', 'scripts', 'migration-guard.mjs');
let dir: string;

const addMigration = (name: string, sql: string) => {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'migration.sql'), sql);
};
const runGuard = (...args: string[]) =>
  spawnSync(process.execPath, [GUARD, ...args], {
    env: { ...process.env, MIGRATION_GUARD_DIR: dir },
    encoding: 'utf8',
  });

describe('migration-guard', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mig-guard-'));
    addMigration('0_init', 'CREATE TABLE "trips" ("id" SERIAL PRIMARY KEY);');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes additive migrations (new tables, nullable columns, indexes)', () => {
    addMigration(
      '20270101000000_add_cols',
      'ALTER TABLE "trips" ADD COLUMN "note" TEXT;\nCREATE INDEX "trips_note_idx" ON "trips"("note");'
    );
    const r = runGuard('--all');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('OK');
  });

  it.each([
    ['DROP COLUMN (what Prisma generates for a field rename)', 'ALTER TABLE "trips" DROP COLUMN "note",\nADD COLUMN "remark" TEXT;'],
    ['DROP TABLE', 'DROP TABLE "coordinates";'],
    ['TRUNCATE', 'TRUNCATE "coordinates";'],
    ['DELETE FROM', 'DELETE FROM "coordinates" WHERE true;'],
    ['column type change', 'ALTER TABLE "trips" ALTER COLUMN "note" SET DATA TYPE INTEGER USING 0;'],
  ])('blocks %s', (_label, sql) => {
    addMigration('20270101000000_risky', sql);
    const r = runGuard('--all');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('BLOCKED');
    expect(r.stderr).toContain('20270101000000_risky');
  });

  it('ignores destructive words inside SQL comments (e.g. Prisma warnings)', () => {
    addMigration(
      '20270101000000_commented',
      '/*\n  Warnings:\n  - You are about to drop the column `x`. DROP COLUMN\n*/\n-- DROP TABLE nothing\nALTER TABLE "trips" ADD COLUMN "y" TEXT;'
    );
    expect(runGuard('--all').status).toBe(0);
  });

  it('allows a destructive migration that carries a reviewed allow-destructive marker', () => {
    addMigration(
      '20270101000000_reviewed',
      '-- allow-destructive: column unused since v1.2, values copied to remark in previous migration\nALTER TABLE "trips" DROP COLUMN "note";'
    );
    const r = runGuard('--all');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('ALLOWED');
  });

  it('only checks migrations not yet applied to the database (pending mode)', () => {
    // These names are already applied to the test database, so their content is not re-checked
    addMigration('20261031000000_osrm_regional_matching', 'DROP TABLE "already_applied";');
    addMigration('20261103000000_kalman_forward_points', 'ALTER TABLE "trips" ADD COLUMN "z" TEXT;');
    const ok = runGuard();
    expect(ok.status).toBe(0);

    addMigration('29990101000000_pending_drop', 'ALTER TABLE "trips" DROP COLUMN "z";');
    const blocked = runGuard();
    expect(blocked.status).toBe(1);
    expect(blocked.stdout).toContain('29990101000000_pending_drop');
    expect(blocked.stderr).not.toContain('already_applied');
  });
});
