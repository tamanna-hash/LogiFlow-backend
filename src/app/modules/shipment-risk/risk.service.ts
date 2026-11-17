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
import { cacheGet, cacheSet } from '../../lib/redis';
import { assessShipmentRisk } from './risk.engine';
import type { RiskEngineInput } from './risk.engine';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import type { RiskHistoryQuery, RiskListQuery, RiskListRole } from './risk.schema';
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
// Includes shipment.trackingNumber so callers have full context.
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
  shipment: {
    select: { trackingNumber: true },
  },
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

// ── Cache key ─────────────────────────────────────────────────────────────────
// Extend the existing CacheKeys factory with a risk-specific key.
// The overview is scoped by role and (for HUB_MANAGER) by hubId.
function riskOverviewCacheKey(role: string, hubId?: string | null): string {
  return `risk:overview:${role}:${hubId ?? 'global'}`;
}

// ── Risk overview ─────────────────────────────────────────────────────────────

/**
 * getRiskOverview — returns aggregate risk counts.
 *
 * Strategy: for each active (non-terminal) shipment, look up its most recent
 * ShipmentRiskAssessment and bin it by riskLevel. Use Prisma groupBy on a
 * subquery is not directly available, so we fetch the latest assessment IDs
 * efficiently with a raw aggregation pattern:
 *   1. Count active shipments that HAVE been assessed (via distinct on shipmentId
 *      in the assessments table, filtered by riskLevel).
 *   2. Count active shipments with no assessment at all.
 *
 * This is two targeted queries — no full table scan.
 *
 * "Requiring attention" = HIGH + MEDIUM risk assessments.
 * "Unassessed" = active non-terminal shipments with zero assessments.
 *
 * Results are cached 2 minutes (matching getSystemStats cadence).
 */
export async function getRiskOverview(role: RiskListRole, hubId?: string | null) {
  const cacheKey = riskOverviewCacheKey(role, hubId);
  const cached = await cacheGet(cacheKey);
  if (cached) return cached;

  // Build a scope filter for the shipments this role can see.
  const shipmentScope = buildShipmentScope(role, hubId);

  // For each risk level, count distinct shipments whose latest assessment is
  // at that level. We use the index on (shipmentId, assessedAt DESC) for this.
  // The pattern: "max assessedAt per shipmentId" = latest assessment.
  // We approximate this with a groupBy on shipmentId selecting MAX(assessedAt),
  // then count per riskLevel — done efficiently in two steps.

  // Step A: get all shipment IDs in scope.
  const scopedShipmentIds = await prisma.shipment.findMany({
    where: { ...shipmentScope, deletedAt: null },
    select: { id: true },
  });
  const ids = scopedShipmentIds.map((s) => s.id);

  if (ids.length === 0) {
    const empty = { total: 0, high: 0, medium: 0, low: 0, unassessed: 0, requiresAttention: 0 };
    await cacheSet(cacheKey, empty, 120);
    return empty;
  }

  // Step B: for each shipment that HAS an assessment, find its latest.
  // We aggregate: for each shipmentId, pick the assessment with MAX(assessedAt).
  // Prisma groupBy gives us the max assessedAt per shipmentId.
  const latestPerShipment = await prisma.shipmentRiskAssessment.groupBy({
    by: ['shipmentId'],
    where: { shipmentId: { in: ids } },
    _max: { assessedAt: true },
  });

  // Step C: fetch the actual riskLevel for each of those "latest" assessments.
  // Build (shipmentId, assessedAt) pairs and fetch the matching rows.
  //
  // PERFORMANCE NOTE (Day 5): This results in N parallel findFirst() queries,
  // one per assessed shipment (N = number of unique assessed shipments).
  // For the current scale (3 hubs, O(10s) of shipments) this is fast.
  // At larger scale, replace with a raw SQL lateral join or a materialized
  // "latest_assessment_per_shipment" view to collapse this into one query.
  // The 2-minute Redis cache (see riskOverviewCacheKey above) limits the
  // frequency of these queries in practice.
  const latestAssessments = await Promise.all(
    latestPerShipment.map((g) =>
      prisma.shipmentRiskAssessment.findFirst({
        where: {
          shipmentId: g.shipmentId,
          assessedAt: g._max.assessedAt!,
        },
        select: { riskLevel: true },
        orderBy: { assessedAt: 'desc' },
      }),
    ),
  );

  // Step D: bin by riskLevel.
  let high = 0;
  let medium = 0;
  let low = 0;

  for (const a of latestAssessments) {
    if (!a) continue;
    if (a.riskLevel === 'HIGH') high++;
    else if (a.riskLevel === 'MEDIUM') medium++;
    else low++;
  }

  const assessed = latestPerShipment.length;
  const unassessed = ids.length - assessed;

  const overview = {
    total: ids.length,
    assessed,
    unassessed,
    high,
    medium,
    low,
    requiresAttention: high + medium,
  };

  await cacheSet(cacheKey, overview, 120); // 2 min TTL
  return overview;
}

// ── High-risk shipments list ───────────────────────────────────────────────────

/**
 * listRiskAssessments — paginated list of the latest risk assessment per
 * shipment, with optional filtering.
 *
 * Returns the most recent ShipmentRiskAssessment for each shipment in scope,
 * joined with the shipment's tracking number, ordered newest-assessment-first.
 *
 * Hub managers only see shipments currently at their hub.
 * Operations managers and admins see all shipments.
 */
export async function listRiskAssessments(
  role: RiskListRole,
  hubId: string | null | undefined,
  params: RiskListQuery,
) {
  const { page, limit, riskLevel, shipmentStatus, search, fromDate, toDate } = params;

  const shipmentScope = buildShipmentScope(role, hubId);

  // Build the assessment-level where clause.
  const assessmentWhere: Prisma.ShipmentRiskAssessmentWhereInput = {
    ...(riskLevel && { riskLevel }),
    ...(shipmentStatus && { shipmentStatus }),
    ...((fromDate || toDate) && {
      assessedAt: {
        ...(fromDate && { gte: new Date(fromDate) }),
        ...(toDate && { lte: new Date(toDate) }),
      },
    }),
    shipment: {
      ...shipmentScope,
      deletedAt: null,
      ...(search && {
        trackingNumber: { contains: search, mode: 'insensitive' as const },
      }),
    },
  };

  // Get the latest assessment per shipment by querying with distinct on
  // shipmentId ordered by assessedAt DESC — Prisma supports this via
  // findMany with distinct + orderBy.
  const [assessments, total] = await Promise.all([
    prisma.shipmentRiskAssessment.findMany({
      where: assessmentWhere,
      orderBy: { assessedAt: 'desc' },
      distinct: ['shipmentId'],
      ...getPrismaSkipTake(page, limit),
      select: assessmentSelect,
    }),
    // For total count, count distinct shipments that have an assessment
    // matching the filter — approximate via counting assessment rows grouped.
    prisma.shipmentRiskAssessment.groupBy({
      by: ['shipmentId'],
      where: assessmentWhere,
    }).then((rows) => rows.length),
  ]);

  return {
    assessments,
    meta: buildPaginationMeta(total, page, limit),
  };
}

// ── Scope builder ─────────────────────────────────────────────────────────────

/**
 * buildShipmentScope — returns a Prisma where fragment scoping shipments
 * to what the requesting role is allowed to see.
 *
 * ADMIN / OPERATIONS_MANAGER → all shipments (no additional filter).
 * HUB_MANAGER → only shipments currently at their hub.
 *
 * Customer and Courier cannot reach these endpoints (enforced by authorize()
 * in the route layer), so they are not handled here.
 */
function buildShipmentScope(
  role: RiskListRole,
  hubId?: string | null,
): Prisma.ShipmentWhereInput {
  if (role === 'HUB_MANAGER' && hubId) {
    return { currentHubId: hubId };
  }
  return {};
}
