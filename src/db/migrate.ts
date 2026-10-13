import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './index.js';
import path from 'path';

export const runMigrations = async () => {
  try {
    const migrationsFolder = path.resolve(process.cwd(), 'drizzle');
    console.log(`Running migrations from ${migrationsFolder}...`);
    await migrate(db, { migrationsFolder });
    console.log('Database migrations applied successfully.');
  } catch (error) {
    console.error('Migration failed:', error);
    throw error;
  }
};

// If run directly from CLI
if (process.argv[1]?.endsWith('migrate.ts')) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async () => {
      await pool.end();
      process.exit(1);
    });
}
