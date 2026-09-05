import { prisma } from '../../lib/prisma';
import { cacheGet, cacheSet, CacheKeys } from '../../lib/redis';
import { notDeleted } from '../../utils/notDeleted';
import { getAuditLogs } from '../audit/audit.service';
import type { AuditAction } from '@prisma/client';

export async function getSystemStats() {
  const cacheKey = CacheKeys.adminStats();
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    totalUsers, totalShipments, activeShipments, deliveredToday,
    totalRevenue, pendingPayments, totalHubs, activeHubs,
  ] = await Promise.all([
    prisma.user.count({ where: notDeleted() }),
    prisma.shipment.count({ where: { deletedAt: null } }),
    prisma.shipment.count({
      where: { deletedAt: null, status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } },
    }),
    prisma.shipment.count({
      where: { deletedAt: null, status: 'DELIVERED', deliveredAt: { gte: today } },
    }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    prisma.payment.count({ where: { status: 'PENDING' } }),
    prisma.hub.count({ where: { deletedAt: null } }),
    prisma.hub.count({ where: { deletedAt: null, isActive: true } }),
  ]);

  const stats = {
    totalUsers,
    totalShipments,
    activeShipments,
    deliveredToday,
    totalRevenue: Number(totalRevenue._sum.amount ?? 0).toFixed(2),
    pendingPayments,
    hubs: { total: totalHubs, active: activeHubs },
  };

  await cacheSet(cacheKey, stats, 120); // 2 min TTL
  return stats;
}

export async function getAuditLogList(params: {
  page: number; limit: number;
  action?: AuditAction; actorId?: string; resourceType?: string;
  resourceId?: string; fromDate?: string; toDate?: string;
  operationalOnly?: boolean;
}) {
  return getAuditLogs(params);
}
