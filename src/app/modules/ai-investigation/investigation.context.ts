/**
 * investigation.context.ts — Shipment Context Builder
 *
 * Fetches the minimum necessary operational data about a shipment for AI
 * investigation. This is the ONLY place where database access happens for
 * the investigation pipeline.
 *
 * PRIVACY principles:
 *  - No customer names or contact details (senderName, recipientName,
 *    senderPhone, recipientPhone, senderAddress, recipientAddress are excluded).
 *  - Origin/destination city and zone names are included — necessary for
 *    routing analysis.
 *  - Courier personal details are excluded; only assignment timestamps and
 *    type/status are included.
 *  - Internal database IDs are excluded from the AI context (irrelevant to
 *    the investigation and reduce token count).
 *  - No passwords, tokens, or audit-log data.
 */

import { prisma } from '../../lib/prisma';
import { NotFoundError, AuthorizationError } from '../../errors';
import type { InvestigationRole } from './investigation.schema';
import type { Prisma } from '../../../generated/prisma';

// ── Context type (what gets serialised and sent to the LLM) ─────────────────

export interface TrackingEventCtx {
  timestamp: string;
  status: string;
  description: string;
  location: string | null;
}

export interface HubTransferCtx {
  fromHub: string | null;
  toHub: string | null;
  status: string;
  dispatchedAt: string;
  estimatedArrival: string | null;
  arrivedAt: string | null;
}

export interface DeliveryAttemptCtx {
  attemptNumber: number;
  status: string;
  failureReason: string | null;
  notes: string | null;
  attemptedAt: string;
  deliveredAt: string | null;
}

export interface AssignmentCtx {
  type: string;
  status: string;
  assignedAt: string;
  acceptedAt: string | null;
  rejectedAt: string | null;
  pickedUpAt: string | null;
  deliveredAt: string | null;
  cancellationReason: string | null;
}

export interface RiskAssessmentCtx {
  riskScore: number;
  riskLevel: string;
  assessmentStatus: string;
  factors: unknown; // JSON — passed through as-is
  assessedAt: string;
  lastEventAt: string | null;
}

export interface ShipmentInvestigationContext {
  // Core shipment info (no PII)
  trackingNumber: string;
  currentStatus: string;
  deliveryType: string;
  parcelType: string;
  declaredWeightKg: number;
  createdAt: string;
  updatedAt: string;
  originCity: string;
  destinationCity: string;
  originZone: string | null;
  destinationZone: string | null;
  currentHubName: string | null;
  currentHubCity: string | null;
  deliveryAttemptCount: number;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  returnReason: string | null;
  // Shipment description — included for context but treated as untrusted data
  description: string | null;
  // Operational history
  trackingEvents: TrackingEventCtx[];
  hubTransfers: HubTransferCtx[];
  deliveryAttempts: DeliveryAttemptCtx[];
  assignments: AssignmentCtx[];
  pickupScheduledAt: string | null;
  // Risk assessment from Day-1 engine
  riskAssessment: RiskAssessmentCtx | null;
}

// ── Prisma query ─────────────────────────────────────────────────────────────

/**
 * buildShipmentScope — same logic as the risk service scope builder.
 * ADMIN / OPERATIONS_MANAGER → no additional filter.
 * HUB_MANAGER → only shipments currently at their hub.
 */
function buildShipmentScope(
  role: InvestigationRole,
  hubId?: string | null,
): Prisma.ShipmentWhereInput {
  if (role === 'HUB_MANAGER' && hubId) {
    return { currentHubId: hubId };
  }
  return {};
}

/**
 * buildInvestigationContext — fetches all data needed for the AI investigation
 * in a single Prisma query and returns it as a sanitized, privacy-safe context
 * object ready to be serialized into the LLM prompt.
 *
 * Access is verified here: if the shipment is not in the user's authorized
 * scope, a 403 is thrown before any data is returned.
 */
export async function buildInvestigationContext(
  shipmentId: string,
  role: InvestigationRole,
  hubId?: string | null,
): Promise<ShipmentInvestigationContext> {
  const scope = buildShipmentScope(role, hubId);

  const shipment = await prisma.shipment.findFirst({
    where: {
      id: shipmentId,
      deletedAt: null,
      ...scope,
    },
    select: {
      trackingNumber: true,
      status: true,
      deliveryType: true,
      parcelType: true,
      declaredWeightKg: true,
      description: true,
      createdAt: true,
      updatedAt: true,
      senderCity: true,        // city only, not full address
      recipientCity: true,     // city only, not full address
      deliveryAttemptCount: true,
      deliveredAt: true,
      cancelledAt: true,
      cancellationReason: true,
      returnReason: true,
      originZone:      { select: { name: true, code: true } },
      destinationZone: { select: { name: true, code: true } },
      currentHub:      { select: { name: true, city: true } },
      trackingEvents: {
        orderBy: { createdAt: 'asc' },
        select: {
          status: true,
          description: true,
          location: true,
          createdAt: true,
        },
      },
      hubTransfers: {
        orderBy: { dispatchedAt: 'asc' },
        select: {
          fromHub:         { select: { name: true } },
          toHub:           { select: { name: true } },
          status: true,
          dispatchedAt: true,
          estimatedArrival: true,
          arrivedAt: true,
        },
      },
      deliveryAttempts: {
        orderBy: { attemptedAt: 'asc' },
        select: {
          attemptNumber: true,
          status: true,
          failureReason: true,
          notes: true,
          attemptedAt: true,
          deliveredAt: true,
        },
      },
      // All assignments (history of courier interactions)
      assignments: {
        orderBy: { assignedAt: 'asc' },
        select: {
          type: true,
          status: true,
          assignedAt: true,
          acceptedAt: true,
          rejectedAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          cancellationReason: true,
        },
      },
      pickupRequest: {
        select: { scheduledAt: true },
      },
      // The most recent risk assessment from the Day-1 engine
      riskAssessments: {
        orderBy: { assessedAt: 'desc' },
        take: 1,
        select: {
          riskScore: true,
          riskLevel: true,
          assessmentStatus: true,
          factors: true,
          assessedAt: true,
          lastEventAt: true,
        },
      },
    },
  });

  // Shipment not found OR not in the caller's authorized scope
  if (!shipment) {
    // Use NotFoundError — does not reveal whether the shipment exists in
    // another hub (prevents enumeration).
    throw new NotFoundError('Shipment not found.');
  }

  // Extra guard: HUB_MANAGER must actually have a hub assigned
  if (role === 'HUB_MANAGER' && !hubId) {
    throw new AuthorizationError('No hub is assigned to this account.');
  }

  const latestAssessment = shipment.riskAssessments[0] ?? null;

  return {
    trackingNumber:       shipment.trackingNumber,
    currentStatus:        shipment.status,
    deliveryType:         shipment.deliveryType,
    parcelType:           shipment.parcelType,
    declaredWeightKg:     shipment.declaredWeightKg,
    createdAt:            shipment.createdAt.toISOString(),
    updatedAt:            shipment.updatedAt.toISOString(),
    originCity:           shipment.senderCity,
    destinationCity:      shipment.recipientCity,
    originZone:           shipment.originZone ? `${shipment.originZone.name} (${shipment.originZone.code})` : null,
    destinationZone:      shipment.destinationZone ? `${shipment.destinationZone.name} (${shipment.destinationZone.code})` : null,
    currentHubName:       shipment.currentHub?.name ?? null,
    currentHubCity:       shipment.currentHub?.city ?? null,
    deliveryAttemptCount: shipment.deliveryAttemptCount,
    deliveredAt:          shipment.deliveredAt?.toISOString() ?? null,
    cancelledAt:          shipment.cancelledAt?.toISOString() ?? null,
    cancellationReason:   shipment.cancellationReason ?? null,
    returnReason:         shipment.returnReason ?? null,
    description:          shipment.description ?? null,

    trackingEvents: shipment.trackingEvents.map((e) => ({
      timestamp:   e.createdAt.toISOString(),
      status:      e.status,
      description: e.description,
      location:    e.location ?? null,
    })),

    hubTransfers: shipment.hubTransfers.map((t) => ({
      fromHub:          t.fromHub?.name ?? null,
      toHub:            t.toHub?.name ?? null,
      status:           t.status,
      dispatchedAt:     t.dispatchedAt.toISOString(),
      estimatedArrival: t.estimatedArrival?.toISOString() ?? null,
      arrivedAt:        t.arrivedAt?.toISOString() ?? null,
    })),

    deliveryAttempts: shipment.deliveryAttempts.map((a) => ({
      attemptNumber: a.attemptNumber,
      status:        a.status,
      failureReason: a.failureReason ?? null,
      notes:         a.notes ?? null,
      attemptedAt:   a.attemptedAt.toISOString(),
      deliveredAt:   a.deliveredAt?.toISOString() ?? null,
    })),

    assignments: shipment.assignments.map((a) => ({
      type:               a.type,
      status:             a.status,
      assignedAt:         a.assignedAt.toISOString(),
      acceptedAt:         a.acceptedAt?.toISOString() ?? null,
      rejectedAt:         a.rejectedAt?.toISOString() ?? null,
      pickedUpAt:         a.pickedUpAt?.toISOString() ?? null,
      deliveredAt:        a.deliveredAt?.toISOString() ?? null,
      cancellationReason: a.cancellationReason ?? null,
    })),

    pickupScheduledAt: shipment.pickupRequest?.scheduledAt?.toISOString() ?? null,

    riskAssessment: latestAssessment
      ? {
          riskScore:        latestAssessment.riskScore,
          riskLevel:        latestAssessment.riskLevel,
          assessmentStatus: latestAssessment.assessmentStatus,
          factors:          latestAssessment.factors,
          assessedAt:       latestAssessment.assessedAt.toISOString(),
          lastEventAt:      latestAssessment.lastEventAt?.toISOString() ?? null,
        }
      : null,
  };
}
