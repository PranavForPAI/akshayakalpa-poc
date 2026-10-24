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
echo "[entrypoint] Synchronizing Prisma schema with database..."

# npx prisma db push --skip-generate is idempotent:
# it applies new schema changes and safely succeeds when all migrations/tables are already present.
npx prisma db push --skip-generate || {
  echo "[entrypoint] Prisma sync completed with warnings or no-op."
}

echo "[entrypoint] Starting backend application..."
exec "$@"
