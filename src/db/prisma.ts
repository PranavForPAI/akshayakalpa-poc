/**
 * Prisma client singleton.
 *
 * NOTE: This module requires `npx prisma generate` to have been run at least once
 * so that @prisma/client types are emitted into node_modules/.prisma/client.
 * Without that step the TypeScript compiler will report TS2305.
 *
 * Re-uses the same instance across hot-reloads in development (tsx watch).
 * Forwards Prisma-level errors and warnings to Winston.
 */

import { PrismaClient } from '@prisma/client';
import logger from '../logger.js';

type PrismaClientType = PrismaClient;

const globalForPrisma = global as unknown as { _prisma: PrismaClientType | undefined };

function createClient(): PrismaClientType {
  const client = new PrismaClient({
    log: [
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

  // Bridge Prisma log events → Winston
  (client as any).$on('error', (e: { message: string; target: string }) => {
    logger.error('Prisma error', { message: e.message, target: e.target });
  });
  (client as any).$on('warn', (e: { message: string; target: string }) => {
    logger.warn('Prisma warning', { message: e.message, target: e.target });
  });

  return client;
}

export const prisma: PrismaClientType =
  globalForPrisma._prisma ?? (globalForPrisma._prisma = createClient());

export default prisma;
