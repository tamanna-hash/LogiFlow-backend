import type { AuditAction } from '@prisma/client';
import { prisma } from '../../lib/prisma';

export interface AuditLogInput {
  actorId?: string | null;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Audit logs are append-only — no update or delete operations.
 * Written inside transactions where possible so rollback also rolls back the audit entry.
 * Never throws — audit failure should not break the parent operation.
 */
export async function createAuditLog(input: AuditLogInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorId: input.actorId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        before: input.before !== undefined ? (input.before as object) : undefined,
        after: input.after !== undefined ? (input.after as object) : undefined,
        metadata: input.metadata !== undefined ? (input.metadata as object) : undefined,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      },
    });
  } catch (err) {
    console.error('[Audit] Failed to write audit log:', err);
  }
}

export async function getAuditLogs(params: {
  page: number;
  limit: number;
  action?: AuditAction;
  actorId?: string;
  resourceType?: string;
  resourceId?: string;
  fromDate?: string;
  toDate?: string;
  operationalOnly?: boolean;
}) {
  const {
    page, limit, action, actorId, resourceType, resourceId,
    fromDate, toDate, operationalOnly,
  } = params;

  const OPERATIONAL_ACTIONS: AuditAction[] = [
    'SHIPMENT_CREATED', 'SHIPMENT_CANCELLED', 'SHIPMENT_STATUS_CHANGED', 'SHIPMENT_ADMIN_OVERRIDE',
    'COURIER_ASSIGNED', 'COURIER_REASSIGNED', 'COURIER_ASSIGNMENT_CANCELLED',
    'COURIER_ASSIGNMENT_ACCEPTED', 'COURIER_ASSIGNMENT_REJECTED',
    'PICKUP_REQUESTED', 'PICKUP_COMPLETED', 'PICKUP_CANCELLED',
    'HUB_TRANSFER_CREATED', 'HUB_TRANSFER_ARRIVED',
    'DELIVERY_ATTEMPTED', 'DELIVERY_CONFIRMED', 'DELIVERY_FAILED',
    'RETURN_INITIATED', 'RETURN_COMPLETED',
  ];

  const where = {
    ...(action && { action }),
    ...(actorId && { actorId }),
    ...(resourceType && { resourceType }),
    ...(resourceId && { resourceId }),
    ...(operationalOnly && { action: { in: OPERATIONAL_ACTIONS } }),
    ...((fromDate || toDate) && {
      createdAt: {
        ...(fromDate && { gte: new Date(fromDate) }),
        ...(toDate && { lte: new Date(toDate) }),
      },
    }),
  };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        action: true,
        resourceType: true,
        resourceId: true,
        before: true,
        after: true,
        metadata: true,
        ipAddress: true,
        createdAt: true,
        actor: {
          select: { id: true, firstName: true, lastName: true, email: true, role: true },
        },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, total };
}
