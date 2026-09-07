import type { PrismaClient } from '../../generated/prisma';

/**
 * PrismaTx — the transaction client type passed to $transaction callbacks.
 * Prisma omits certain methods ($transaction, $connect, etc.) inside a transaction.
 * Using `typeof prisma` is the simplest safe approximation for service code.
 *
 * Usage:
 *   import type { PrismaTx } from '../../types/prisma';
 *   await prisma.$transaction(async (tx: PrismaTx) => { ... })
 */
export type PrismaTx = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
