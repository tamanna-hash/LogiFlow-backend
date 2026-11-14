/**
 * Shipment Risk Calculation Engine
 *
 * A pure, deterministic function with no database access or side effects.
 * Given a RiskEngineInput snapshot of a shipment's operational state,
 * it produces a fully-explained RiskEngineOutput.
 *
 * Design guarantees:
 * - Same input always produces the same output (deterministic).
 * - No I/O — safe to call in unit tests without mocking anything.
 * - Each risk factor is non-cumulative within its own category
 *   (worst-case value wins), cumulative across categories.
 * - Final score is clamped to [0, 100].
 * - Terminal and undefined statuses return score=0, riskLevel=LOW, factors=[].
 * - Missing event history returns assessmentStatus=INSUFFICIENT_DATA.
 */

import type { ShipmentStatus } from '../../../generated/prisma';
import type { RiskAssessmentStatus, RiskFactorCode, RiskLevel } from '../../../generated/prisma';

// ── Hours helper ──────────────────────────────────────────────────────────────

const HOURS_MS = 60 * 60 * 1000;

function hoursToMs(h: number): number {
  return h * HOURS_MS;
}

function elapsedHours(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOURS_MS;
}

// ── Inactivity thresholds (hours per status) ──────────────────────────────────
// Basis: each threshold represents the upper bound of normal operational time
// for a shipment to remain in that status before attention is warranted.
// See PHASE3 technical comparison for the rationale behind each value.

export const INACTIVITY_THRESHOLD_HOURS: Partial<Record<ShipmentStatus, number>> = {
  CREATED: 48,
  PICKUP_REQUESTED: 24,
  ASSIGNED: 12,
  PICKED_UP: 24,
  AT_ORIGIN_HUB: 24,
  IN_TRANSIT: 72,
  AT_DESTINATION_HUB: 12,
  OUT_FOR_DELIVERY: 24,
  DELIVERY_FAILED: 48,
  RETURN_INITIATED: 48,
  RETURNING: 72,
  // Terminal statuses intentionally omitted — they are never scored.
  // DELIVERED, CANCELLED, RETURNED → no risk signal.
};

// ── Score contribution constants ──────────────────────────────────────────────
// Values represent the weight of each risk factor. Chosen to produce a
// risk level (LOW/MEDIUM/HIGH) that is operationally meaningful:
//   - Inactivity alone past its threshold → HIGH (35 → not quite, but
//     combined with a failed attempt → 55 = MEDIUM; both critical → easily HIGH)
//   - 2+ failed delivery attempts alone → MEDIUM (40)
//   - Max failed attempts → HIGH when combined with inactivity

const SCORE = {
  INACTIVE_WARNING: 15,  // 50–100% of threshold elapsed
  INACTIVE_CRITICAL: 35, // >100% of threshold elapsed (replaces WARNING — worst-case wins)
  COURIER_NOT_ACCEPTED: 15, // Active assignment unaccepted > 4 h
  MULTIPLE_HUB_TRANSFERS: 10, // >2 transfers on the same shipment
  FAILED_ATTEMPT_1: 20,
  FAILED_ATTEMPT_2: 40, // Replaces ATTEMPT_1 — worst-case wins
  FAILED_ATTEMPT_MAX: 50, // At or approaching the configured attempt ceiling
} as const;

// Courier non-acceptance threshold (hours)
const COURIER_NOT_ACCEPTED_THRESHOLD_HOURS = 4;

// ── Score → RiskLevel mapping ─────────────────────────────────────────────────

function scoreToRiskLevel(score: number): RiskLevel {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RiskFactor {
  code: RiskFactorCode;
  score: number;
  evidence: string;
}

export interface RiskEngineInput {
  shipmentId: string;
  currentStatus: ShipmentStatus;
  createdAt: Date;
  deliveryAttemptCount: number;
  /** Timestamp of the most recent ShipmentTrackingEvent. Null if no events exist. */
  lastEventAt: Date | null;
  /** Active (unrejected, uncancelled) courier assignment, if one exists. */
  activeAssignment: {
    assignedAt: Date;
    acceptedAt: Date | null;
  } | null;
  /** Total number of HubTransfer records for this shipment across all legs. */
  hubTransferCount: number;
  /**
   * The point-in-time for the assessment. Injected by the service so the
   * engine is fully deterministic (no internal Date.now() calls).
   */
  assessedAt: Date;
  /** Configurable ceiling from env.MAX_DELIVERY_ATTEMPTS (default: 3). */
  maxDeliveryAttempts: number;
}

export interface RiskEngineOutput {
  score: number;
  riskLevel: RiskLevel;
  assessmentStatus: RiskAssessmentStatus;
  factors: RiskFactor[];
}

// ── Terminal status guard ─────────────────────────────────────────────────────

const TERMINAL: Set<ShipmentStatus> = new Set(['DELIVERED', 'CANCELLED', 'RETURNED']);

function isTerminal(status: ShipmentStatus): boolean {
  return TERMINAL.has(status);
}

// ── Core engine ───────────────────────────────────────────────────────────────

/**
 * assessShipmentRisk — deterministic, side-effect-free risk scoring.
 *
 * Call order within each factor category:
 * 1. Evaluate all conditions.
 * 2. Push only the highest-scoring condition (worst-case wins within category).
 * 3. Accumulate the final score across all categories.
 * 4. Clamp to [0, 100].
 */
export function assessShipmentRisk(input: RiskEngineInput): RiskEngineOutput {
  const { currentStatus, deliveryAttemptCount, lastEventAt, activeAssignment,
    hubTransferCount, assessedAt, maxDeliveryAttempts } = input;

  // ── Guard: terminal shipments are never at risk ───────────────────────────
  if (isTerminal(currentStatus)) {
    return {
      score: 0,
      riskLevel: 'LOW',
      assessmentStatus: 'ASSESSED',
      factors: [],
    };
  }

  // ── Guard: no event history (should not occur in normal operation) ─────────
  if (lastEventAt === null) {
    return {
      score: 0,
      riskLevel: 'LOW',
      assessmentStatus: 'INSUFFICIENT_DATA',
      factors: [],
    };
  }

  const factors: RiskFactor[] = [];
  let rawScore = 0;

  // ── Factor category 1: Status inactivity ──────────────────────────────────
  // Compare elapsed time since the last tracking event against the per-status
  // threshold. Use the lastEventAt timestamp (actual event time from the
  // append-only ShipmentTrackingEvent log) as the reference point.
  const thresholdHours = INACTIVITY_THRESHOLD_HOURS[currentStatus];

  if (thresholdHours !== undefined) {
    const elapsedH = elapsedHours(lastEventAt, assessedAt);
    const thresholdMs = hoursToMs(thresholdHours);
    const warningMs = thresholdMs * 0.5; // 50% of threshold → warning
    const elapsedMs = assessedAt.getTime() - lastEventAt.getTime();

    if (elapsedMs > thresholdMs) {
      // Critical: fully past the threshold
      const overbyHours = elapsedH - thresholdHours;
      factors.push({
        code: 'STATUS_INACTIVE_CRITICAL',
        score: SCORE.INACTIVE_CRITICAL,
        evidence: `Shipment has been in ${currentStatus} for ${elapsedH.toFixed(1)}h, exceeding the ${thresholdHours}h threshold by ${overbyHours.toFixed(1)}h.`,
      });
      rawScore += SCORE.INACTIVE_CRITICAL;
    } else if (elapsedMs > warningMs) {
      // Warning: 50–100% of threshold elapsed
      const percentUsed = Math.round((elapsedMs / thresholdMs) * 100);
      factors.push({
        code: 'STATUS_INACTIVE_WARNING',
        score: SCORE.INACTIVE_WARNING,
        evidence: `Shipment has been in ${currentStatus} for ${elapsedH.toFixed(1)}h (${percentUsed}% of the ${thresholdHours}h threshold).`,
      });
      rawScore += SCORE.INACTIVE_WARNING;
    }
    // Below 50% of threshold → no inactivity signal (normal operation)
  }

  // ── Factor category 2: Failed delivery attempts ───────────────────────────
  // Worst-case wins: only the highest applicable tier is added.
  // The tier is determined by deliveryAttemptCount, not by individual attempt
  // records, because deliveryAttemptCount is the authoritative counter on the
  // Shipment row (maintained by both recordDelivery and recordDeliveryFailed).
  if (deliveryAttemptCount > 0) {
    if (deliveryAttemptCount >= maxDeliveryAttempts) {
      factors.push({
        code: 'FAILED_DELIVERY_ATTEMPT_MAX',
        score: SCORE.FAILED_ATTEMPT_MAX,
        evidence: `${deliveryAttemptCount} failed delivery attempt(s), at or above the configured maximum of ${maxDeliveryAttempts}.`,
      });
      rawScore += SCORE.FAILED_ATTEMPT_MAX;
    } else if (deliveryAttemptCount >= 2) {
      factors.push({
        code: 'FAILED_DELIVERY_ATTEMPT_2',
        score: SCORE.FAILED_ATTEMPT_2,
        evidence: `${deliveryAttemptCount} failed delivery attempts recorded.`,
      });
      rawScore += SCORE.FAILED_ATTEMPT_2;
    } else {
      // deliveryAttemptCount === 1
      factors.push({
        code: 'FAILED_DELIVERY_ATTEMPT_1',
        score: SCORE.FAILED_ATTEMPT_1,
        evidence: '1 failed delivery attempt recorded.',
      });
      rawScore += SCORE.FAILED_ATTEMPT_1;
    }
  }

  // ── Factor category 3: Courier not accepted ───────────────────────────────
  // The assignment lifecycle requires the courier to call acceptAssignment
  // before confirmPickup or recordDelivery. An unaccepted assignment that is
  // more than COURIER_NOT_ACCEPTED_THRESHOLD_HOURS old indicates the courier
  // may be unresponsive. Only meaningful in ASSIGNED or OUT_FOR_DELIVERY.
  if (
    activeAssignment !== null &&
    activeAssignment.acceptedAt === null &&
    (currentStatus === 'ASSIGNED' || currentStatus === 'OUT_FOR_DELIVERY' || currentStatus === 'RETURNING')
  ) {
    const waitHours = elapsedHours(activeAssignment.assignedAt, assessedAt);
    if (waitHours > COURIER_NOT_ACCEPTED_THRESHOLD_HOURS) {
      factors.push({
        code: 'COURIER_NOT_ACCEPTED',
        score: SCORE.COURIER_NOT_ACCEPTED,
        evidence: `Courier has not accepted the assignment in ${waitHours.toFixed(1)}h (threshold: ${COURIER_NOT_ACCEPTED_THRESHOLD_HOURS}h).`,
      });
      rawScore += SCORE.COURIER_NOT_ACCEPTED;
    }
  }

  // ── Factor category 4: Multiple hub transfers ─────────────────────────────
  // More than 2 hub transfers suggests a routing problem or repeated
  // misdelivery to the wrong hub. The factor is flat — routing complexity
  // is binary (unusual vs not unusual) rather than incremental.
  if (hubTransferCount > 2) {
    factors.push({
      code: 'MULTIPLE_HUB_TRANSFERS',
      score: SCORE.MULTIPLE_HUB_TRANSFERS,
      evidence: `${hubTransferCount} hub transfers recorded (expected at most 2 for a standard route).`,
    });
    rawScore += SCORE.MULTIPLE_HUB_TRANSFERS;
  }

  // ── Clamp and classify ────────────────────────────────────────────────────
  const score = Math.min(100, Math.max(0, rawScore));

  return {
    score,
    riskLevel: scoreToRiskLevel(score),
    assessmentStatus: 'ASSESSED',
    factors,
  };
}

// ── Exported constants (for use in tests and documentation) ──────────────────

export { SCORE as RISK_SCORES, COURIER_NOT_ACCEPTED_THRESHOLD_HOURS };
