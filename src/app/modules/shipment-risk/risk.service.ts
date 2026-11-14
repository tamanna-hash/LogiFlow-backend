/**
 * Shipment Risk Service
 *
 * Orchestrates the risk assessment lifecycle:
 * 1. Fetch the operational snapshot from the database (single efficient query).
 * 2. Delegate scoring to the pure risk engine (no DB calls inside the engine).
 * 3. Persist the result via an append-only INSERT.
 * 4. Write an audit log entry.
 * 5. Return the persisted assessment.
 *
 * The service is intentionally thin: all business logic lives in risk.engine.ts.
 */

import { prisma } from '../../lib/prisma';
import { NotFoundError } from '../../errors';
import { env } from '../../config/env';
import { createAuditLog } from '../audit/audit.service';
import { assessShipmentRisk } from './risk.engine';
import type { RiskEngineInput } from './risk.engine';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import type { RiskHistoryQuery } from './risk.schema';
import type { Prisma } from '../../../generated/prisma';

// ── Prisma select shapes ──────────────────────────────────────────────────────

/** Minimal shipment snapshot needed to run the risk engine. */
const shipmentRiskSelect = {
  id: true,
  status: true,
  createdAt: true,
  deliveryAttemptCount: true,
  deletedAt: true,
  // Latest tracking event timestamp — the authoritative "last activity" signal.
  trackingEvents: {
    orderBy: { createdAt: 'desc' as const },
    take: 1,
    select: { createdAt: true },
  },
  // Active courier assignment — needed to detect unaccepted assignments.
  assignments: {
    where: { status: 'ACTIVE' as const },
    take: 1,
    select: { assignedAt: true, acceptedAt: true },
  },
  // Hub transfer count — a simple aggregate is preferable but Prisma's
  // findUnique does not support _count on nested relations in a select, so
  // we include the minimal hubTransfers array and count client-side.
  hubTransfers: {
    select: { id: true },
  },
} as const;

// Select shape for returning persisted assessments
const assessmentSelect = {
  id: true,
  shipmentId: true,
  riskScore: true,
  riskLevel: true,
  assessmentStatus: true,
  factors: true,
  shipmentStatus: true,
  lastEventAt: true,
  assessedAt: true,
} as const;

// ── Public service functions ──────────────────────────────────────────────────

/**
 * assessAndPersistRisk — fetch shipment data, run the engine, persist the
 * result, and return it. The assessment is always a fresh INSERT (not an
 * upsert) so the full history is retained for future trend analysis.
 *
 * Access control is enforced at the route/controller layer; this function
 * receives a validated shipmentId and the actor's userId for auditing.
 */
export async function assessAndPersistRisk(shipmentId: string, actorId: string) {
  // ── 1. Fetch operational snapshot ─────────────────────────────────────────
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: shipmentRiskSelect,
  });

  if (!shipment) throw new NotFoundError('Shipment not found.');

  // ── 2. Build engine input ─────────────────────────────────────────────────
  const lastEventAt = shipment.trackingEvents[0]?.createdAt ?? null;
  const activeAssignment = shipment.assignments[0] ?? null;

  const engineInput: RiskEngineInput = {
    shipmentId: shipment.id,
    currentStatus: shipment.status,
    createdAt: shipment.createdAt,
    deliveryAttemptCount: shipment.deliveryAttemptCount,
    lastEventAt,
    activeAssignment: activeAssignment
      ? { assignedAt: activeAssignment.assignedAt, acceptedAt: activeAssignment.acceptedAt }
      : null,
    hubTransferCount: shipment.hubTransfers.length,
    assessedAt: new Date(), // injected so the engine is deterministic
    maxDeliveryAttempts: env.MAX_DELIVERY_ATTEMPTS,
  };

  // ── 3. Run the engine ─────────────────────────────────────────────────────
  const result = assessShipmentRisk(engineInput);

  // ── 4. Persist ────────────────────────────────────────────────────────────
  const assessment = await prisma.shipmentRiskAssessment.create({
    data: {
      shipmentId: shipment.id,
      riskScore: result.score,
      riskLevel: result.riskLevel,
      assessmentStatus: result.assessmentStatus,
      factors: result.factors as unknown as Prisma.InputJsonValue,
      shipmentStatus: shipment.status,
      lastEventAt,
    },
    select: assessmentSelect,
  });

  // ── 5. Audit log (non-blocking — failure must not break the response) ─────
  void createAuditLog({
    actorId,
    action: 'RISK_ASSESSMENT_CREATED',
    resourceType: 'ShipmentRiskAssessment',
    resourceId: assessment.id,
    after: {
      shipmentId,
      riskScore: result.score,
      riskLevel: result.riskLevel,
      factorCount: result.factors.length,
    },
  });

  return assessment;
}

/**
 * getLatestAssessment — returns the most recent assessment for a shipment,
 * or null if none has been run yet.
 */
export async function getLatestAssessment(shipmentId: string) {
  // Confirm the shipment exists first so we can return a meaningful 404
  const exists = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Shipment not found.');

  return prisma.shipmentRiskAssessment.findFirst({
    where: { shipmentId },
    orderBy: { assessedAt: 'desc' },
    select: assessmentSelect,
  });
}

/**
 * listAssessmentHistory — paginated list of all assessments for a shipment,
 * newest first. Useful for trend analysis and Day 2 operational dashboards.
 */
export async function listAssessmentHistory(shipmentId: string, params: RiskHistoryQuery) {
  const exists = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Shipment not found.');

  const where = { shipmentId };
  const [assessments, total] = await Promise.all([
    prisma.shipmentRiskAssessment.findMany({
      where,
      orderBy: { assessedAt: 'desc' },
      ...getPrismaSkipTake(params.page, params.limit),
      select: assessmentSelect,
    }),
    prisma.shipmentRiskAssessment.count({ where }),
  ]);

  return {
    assessments,
    meta: buildPaginationMeta(total, params.page, params.limit),
  };
}
