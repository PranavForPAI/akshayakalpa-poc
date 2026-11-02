#!/bin/sh
set -e

echo "[entrypoint] Checking PostgreSQL connection..."
RETRIES=30
until node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$connect()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
" > /dev/null 2>&1 || [ $RETRIES -eq 0 ]; do
  echo "[entrypoint] Waiting for database to become ready ($RETRIES retries left)..."
  RETRIES=$((RETRIES - 1))
  sleep 2
done

if [ $RETRIES -eq 0 ]; then
  echo "[entrypoint] ERROR: Timed out waiting for PostgreSQL database."
  exit 1
fi

echo "[entrypoint] Database is reachable."

# One-time baseline for databases created earlier with `prisma db push`:
# they have the tables but no _prisma_migrations history. Mark 0_init (the schema as it was
# before migrations were introduced) as already applied so deploy does not try to recreate it.
NEEDS_BASELINE=$(node -e "
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  prisma.\$queryRawUnsafe(\"SELECT to_regclass('public._prisma_migrations')::text AS m, to_regclass('public.trips')::text AS t\")
    .then(([r]) => { console.log(!r.m && r.t ? 'yes' : 'no'); return prisma.\$disconnect(); })
    .catch((e) => { console.error(e.message); process.exit(1); });
")

if [ "$NEEDS_BASELINE" = "yes" ]; then
  echo "[entrypoint] Existing database without migration history detected; baselining 0_init..."
  npx prisma migrate resolve --applied 0_init
fi

# Applies only pending, committed migrations from prisma/migrations. Never resets or drops data.
# Fails the container start if a migration fails, instead of running against a wrong schema.
echo "[entrypoint] Applying pending database migrations..."
npx prisma migrate deploy

echo "[entrypoint] Starting backend application..."
exec "$@"
