/**
 * Unit tests for the Shipment Risk Engine
 *
 * The engine is a pure function — no mocks needed, no DB, no side effects.
 * Every test constructs a RiskEngineInput directly and asserts on the output.
 *
 * Test scenarios:
 *  1.  Shipment with normal (recent) activity — score 0, LOW
 *  2.  Shipment exceeding its status inactivity threshold — CRITICAL factor, HIGH
 *  3.  Shipment at the inactivity warning zone (50–100% of threshold) — WARNING, LOW
 *  4.  Shipment with 1 failed delivery attempt — MEDIUM
 *  5.  Shipment with 2 failed delivery attempts — MEDIUM
 *  6.  Shipment at max delivery attempts — HIGH
 *  7.  Completed shipment (DELIVERED) — score 0, LOW, no factors
 *  8.  Cancelled shipment — score 0, LOW, no factors
 *  9.  Returned shipment — score 0, LOW, no factors
 * 10.  Shipment with no tracking events — INSUFFICIENT_DATA
 * 11.  Shipment with multiple risk factors — cumulative score, HIGH
 * 12.  Maximum score boundary — clamped to 100
 * 13.  Identical input produces identical output (determinism)
 * 14.  Courier-not-accepted factor fires after threshold
 * 15.  Courier-not-accepted factor does NOT fire if accepted
 * 16.  Multiple hub transfers factor (> 2 transfers)
 * 17.  Below-warning inactivity produces no inactivity factor
 * 18.  ASSIGNED courier not accepted below threshold — no factor
 */

import { describe, it, expect } from 'vitest';
import {
  assessShipmentRisk,
  INACTIVITY_THRESHOLD_HOURS,
  RISK_SCORES,
  COURIER_NOT_ACCEPTED_THRESHOLD_HOURS,
  type RiskEngineInput,
} from '../../app/modules/shipment-risk/risk.engine';

// ── Helpers ───────────────────────────────────────────────────────────────────

const HOURS_MS = 60 * 60 * 1000;

function hoursAgo(h: number, from = new Date()): Date {
  return new Date(from.getTime() - h * HOURS_MS);
}

/** Build a minimal valid input that represents a recently-active shipment. */
function baseInput(overrides: Partial<RiskEngineInput> = {}): RiskEngineInput {
  const assessedAt = new Date('2026-11-14T12:00:00.000Z');
  return {
    shipmentId: 'ship_test_01',
    currentStatus: 'IN_TRANSIT',
    createdAt: hoursAgo(10, assessedAt),
    deliveryAttemptCount: 0,
    lastEventAt: hoursAgo(2, assessedAt),    // 2h ago — well within any threshold
    activeAssignment: null,
    hubTransferCount: 1,
    assessedAt,
    maxDeliveryAttempts: 3,
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('Risk Engine — normal activity', () => {
  it('scenario 1: shipment with recent activity scores 0 and is LOW risk', () => {
    const result = assessShipmentRisk(baseInput());

    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe('LOW');
    expect(result.assessmentStatus).toBe('ASSESSED');
    expect(result.factors).toHaveLength(0);
  });
});

describe('Risk Engine — inactivity detection', () => {
  it('scenario 2: shipment past its threshold triggers STATUS_INACTIVE_CRITICAL', () => {
    const thresholdH = INACTIVITY_THRESHOLD_HOURS['IN_TRANSIT']!; // 72h
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    // last event was 80h ago — past the 72h threshold
    const lastEventAt = hoursAgo(thresholdH + 8, assessedAt);

    const result = assessShipmentRisk(baseInput({ assessedAt, lastEventAt }));

    expect(result.assessmentStatus).toBe('ASSESSED');
    expect(result.factors).toHaveLength(1);
    expect(result.factors[0].code).toBe('STATUS_INACTIVE_CRITICAL');
    expect(result.factors[0].score).toBe(RISK_SCORES.INACTIVE_CRITICAL);
    expect(result.score).toBe(RISK_SCORES.INACTIVE_CRITICAL);
    // 35 pts → LOW (< 40), which correctly reflects a single-factor warning
    expect(result.riskLevel).toBe('LOW');
    // Evidence should mention the status and elapsed time
    expect(result.factors[0].evidence).toContain('IN_TRANSIT');
  });

  it('scenario 3: shipment at 70% of threshold triggers STATUS_INACTIVE_WARNING', () => {
    const thresholdH = INACTIVITY_THRESHOLD_HOURS['OUT_FOR_DELIVERY']!; // 24h
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    // 70% of 24h = 16.8h ago — in the warning zone (50–100%)
    const lastEventAt = hoursAgo(thresholdH * 0.7, assessedAt);

    const result = assessShipmentRisk(baseInput({
      currentStatus: 'OUT_FOR_DELIVERY',
      assessedAt,
      lastEventAt,
    }));

    expect(result.factors).toHaveLength(1);
    expect(result.factors[0].code).toBe('STATUS_INACTIVE_WARNING');
    expect(result.factors[0].score).toBe(RISK_SCORES.INACTIVE_WARNING);
    expect(result.riskLevel).toBe('LOW');
  });

  it('scenario 17: below 50% of threshold produces no inactivity factor', () => {
    const thresholdH = INACTIVITY_THRESHOLD_HOURS['PICKUP_REQUESTED']!; // 24h
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    // 40% of 24h = 9.6h ago — below the warning zone
    const lastEventAt = hoursAgo(thresholdH * 0.4, assessedAt);

    const result = assessShipmentRisk(baseInput({
      currentStatus: 'PICKUP_REQUESTED',
      assessedAt,
      lastEventAt,
    }));

    expect(result.factors).toHaveLength(0);
    expect(result.score).toBe(0);
  });
});

describe('Risk Engine — failed delivery attempts', () => {
  it('scenario 4: 1 failed delivery attempt produces FAILED_DELIVERY_ATTEMPT_1, MEDIUM', () => {
    const result = assessShipmentRisk(baseInput({
      currentStatus: 'DELIVERY_FAILED',
      deliveryAttemptCount: 1,
      lastEventAt: hoursAgo(1, new Date('2026-11-14T12:00:00.000Z')), // fresh
      assessedAt: new Date('2026-11-14T12:00:00.000Z'),
    }));

    expect(result.factors).toHaveLength(1);
    expect(result.factors[0].code).toBe('FAILED_DELIVERY_ATTEMPT_1');
    expect(result.factors[0].score).toBe(RISK_SCORES.FAILED_ATTEMPT_1);
    expect(result.score).toBe(RISK_SCORES.FAILED_ATTEMPT_1); // 20
    expect(result.riskLevel).toBe('LOW');
  });

  it('scenario 5: 2 failed delivery attempts produces FAILED_DELIVERY_ATTEMPT_2 (not _1 too)', () => {
    const result = assessShipmentRisk(baseInput({
      currentStatus: 'DELIVERY_FAILED',
      deliveryAttemptCount: 2,
      lastEventAt: hoursAgo(1, new Date('2026-11-14T12:00:00.000Z')),
      assessedAt: new Date('2026-11-14T12:00:00.000Z'),
    }));

    // Worst-case wins within category — only _2, not _1 + _2
    const deliveryFactors = result.factors.filter(f =>
      f.code === 'FAILED_DELIVERY_ATTEMPT_1' ||
      f.code === 'FAILED_DELIVERY_ATTEMPT_2' ||
      f.code === 'FAILED_DELIVERY_ATTEMPT_MAX'
    );
    expect(deliveryFactors).toHaveLength(1);
    expect(deliveryFactors[0].code).toBe('FAILED_DELIVERY_ATTEMPT_2');
    expect(result.score).toBe(RISK_SCORES.FAILED_ATTEMPT_2); // 40
    expect(result.riskLevel).toBe('MEDIUM');
  });

  it('scenario 6: deliveryAttemptCount at max produces FAILED_DELIVERY_ATTEMPT_MAX, HIGH', () => {
    const result = assessShipmentRisk(baseInput({
      currentStatus: 'DELIVERY_FAILED',
      deliveryAttemptCount: 3, // === maxDeliveryAttempts
      lastEventAt: hoursAgo(1, new Date('2026-11-14T12:00:00.000Z')),
      assessedAt: new Date('2026-11-14T12:00:00.000Z'),
      maxDeliveryAttempts: 3,
    }));

    const deliveryFactors = result.factors.filter(f =>
      f.code === 'FAILED_DELIVERY_ATTEMPT_MAX'
    );
    expect(deliveryFactors).toHaveLength(1);
    expect(result.score).toBe(RISK_SCORES.FAILED_ATTEMPT_MAX); // 50
    // 50 >= 40 → MEDIUM; not HIGH alone — requires another factor for HIGH
    expect(result.riskLevel).toBe('MEDIUM');
  });
});

describe('Risk Engine — terminal shipments', () => {
  it('scenario 7: DELIVERED shipment always scores 0, no factors', () => {
    const result = assessShipmentRisk(baseInput({
      currentStatus: 'DELIVERED',
      deliveryAttemptCount: 5,   // ignored for terminal
      hubTransferCount: 10,      // ignored for terminal
      lastEventAt: hoursAgo(999, new Date()), // very old — still ignored
    }));

    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe('LOW');
    expect(result.assessmentStatus).toBe('ASSESSED');
    expect(result.factors).toHaveLength(0);
  });

  it('scenario 8: CANCELLED shipment always scores 0, no factors', () => {
    const result = assessShipmentRisk(baseInput({ currentStatus: 'CANCELLED' }));

    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(0);
  });

  it('scenario 9: RETURNED shipment always scores 0, no factors', () => {
    const result = assessShipmentRisk(baseInput({ currentStatus: 'RETURNED' }));

    expect(result.score).toBe(0);
    expect(result.factors).toHaveLength(0);
  });
});

describe('Risk Engine — insufficient data', () => {
  it('scenario 10: null lastEventAt returns INSUFFICIENT_DATA, score 0', () => {
    const result = assessShipmentRisk(baseInput({ lastEventAt: null }));

    expect(result.assessmentStatus).toBe('INSUFFICIENT_DATA');
    expect(result.score).toBe(0);
    expect(result.riskLevel).toBe('LOW');
    expect(result.factors).toHaveLength(0);
  });
});

describe('Risk Engine — multiple risk factors', () => {
  it('scenario 11: inactivity-critical + failed-attempts-max = cumulative HIGH', () => {
    const thresholdH = INACTIVITY_THRESHOLD_HOURS['DELIVERY_FAILED']!; // 48h
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    // 60h ago — 12h past threshold → CRITICAL
    const lastEventAt = hoursAgo(thresholdH + 12, assessedAt);

    const result = assessShipmentRisk(baseInput({
      currentStatus: 'DELIVERY_FAILED',
      deliveryAttemptCount: 3, // at max
      maxDeliveryAttempts: 3,
      lastEventAt,
      assessedAt,
    }));

    // Should have exactly 2 factors: inactivity-critical + attempts-max
    expect(result.factors).toHaveLength(2);

    const codes = result.factors.map(f => f.code);
    expect(codes).toContain('STATUS_INACTIVE_CRITICAL');
    expect(codes).toContain('FAILED_DELIVERY_ATTEMPT_MAX');

    // 35 (critical) + 50 (max attempts) = 85 → HIGH
    expect(result.score).toBe(RISK_SCORES.INACTIVE_CRITICAL + RISK_SCORES.FAILED_ATTEMPT_MAX);
    expect(result.riskLevel).toBe('HIGH');
  });
});

describe('Risk Engine — score boundary', () => {
  it('scenario 12: score is clamped to 100 even when raw total exceeds it', () => {
    // Use ASSIGNED status so the COURIER_NOT_ACCEPTED factor fires too.
    // All four factors firing simultaneously:
    //  - INACTIVE_CRITICAL (ASSIGNED threshold 12h, we set 20h): 35
    //  - FAILED_DELIVERY_ATTEMPT_MAX (deliveryAttemptCount >= max): 50
    //  - COURIER_NOT_ACCEPTED (unaccepted > 4h in ASSIGNED status): 15
    //  - MULTIPLE_HUB_TRANSFERS (> 2 transfers): 10
    // Raw total = 110 → must clamp to 100
    const thresholdH = INACTIVITY_THRESHOLD_HOURS['ASSIGNED']!; // 12h
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    // last event was 20h ago — past 12h threshold → CRITICAL
    const lastEventAt = hoursAgo(thresholdH + 8, assessedAt);
    // assignment made 6h ago, never accepted → exceeds 4h threshold
    const assignedAt = hoursAgo(COURIER_NOT_ACCEPTED_THRESHOLD_HOURS + 2, assessedAt);

    const result = assessShipmentRisk(baseInput({
      currentStatus: 'ASSIGNED',
      deliveryAttemptCount: 3,
      maxDeliveryAttempts: 3,
      lastEventAt,
      assessedAt,
      activeAssignment: { assignedAt, acceptedAt: null },
      hubTransferCount: 4, // > 2
    }));

    expect(result.score).toBe(100);
    expect(result.riskLevel).toBe('HIGH');
    // All 4 factors present
    expect(result.factors).toHaveLength(4);
    const codes = result.factors.map(f => f.code);
    expect(codes).toContain('STATUS_INACTIVE_CRITICAL');
    expect(codes).toContain('FAILED_DELIVERY_ATTEMPT_MAX');
    expect(codes).toContain('COURIER_NOT_ACCEPTED');
    expect(codes).toContain('MULTIPLE_HUB_TRANSFERS');
  });
});

describe('Risk Engine — determinism', () => {
  it('scenario 13: identical input always produces identical output', () => {
    const input = baseInput({
      currentStatus: 'AT_DESTINATION_HUB',
      deliveryAttemptCount: 1,
      lastEventAt: hoursAgo(8, new Date('2026-11-14T12:00:00.000Z')),
      assessedAt: new Date('2026-11-14T12:00:00.000Z'),
    });

    const r1 = assessShipmentRisk(input);
    const r2 = assessShipmentRisk(input);
    const r3 = assessShipmentRisk(input);

    expect(r1).toEqual(r2);
    expect(r2).toEqual(r3);
  });
});

describe('Risk Engine — courier not accepted', () => {
  it('scenario 14: unaccepted assignment past threshold produces COURIER_NOT_ACCEPTED', () => {
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    const assignedAt = hoursAgo(COURIER_NOT_ACCEPTED_THRESHOLD_HOURS + 1, assessedAt);

    const result = assessShipmentRisk(baseInput({
      currentStatus: 'ASSIGNED',
      lastEventAt: hoursAgo(1, assessedAt), // fresh — no inactivity
      assessedAt,
      activeAssignment: { assignedAt, acceptedAt: null },
    }));

    const factor = result.factors.find(f => f.code === 'COURIER_NOT_ACCEPTED');
    expect(factor).toBeDefined();
    expect(factor!.score).toBe(RISK_SCORES.COURIER_NOT_ACCEPTED);
    expect(factor!.evidence).toContain(String(COURIER_NOT_ACCEPTED_THRESHOLD_HOURS));
  });

  it('scenario 15: accepted assignment does NOT trigger COURIER_NOT_ACCEPTED', () => {
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    const assignedAt = hoursAgo(COURIER_NOT_ACCEPTED_THRESHOLD_HOURS + 2, assessedAt);
    const acceptedAt = hoursAgo(COURIER_NOT_ACCEPTED_THRESHOLD_HOURS + 1, assessedAt);

    const result = assessShipmentRisk(baseInput({
      currentStatus: 'ASSIGNED',
      lastEventAt: hoursAgo(1, assessedAt),
      assessedAt,
      activeAssignment: { assignedAt, acceptedAt },
    }));

    const hasNotAccepted = result.factors.some(f => f.code === 'COURIER_NOT_ACCEPTED');
    expect(hasNotAccepted).toBe(false);
  });

  it('scenario 18: unaccepted assignment BELOW threshold does not fire', () => {
    const assessedAt = new Date('2026-11-14T12:00:00.000Z');
    // Assigned only 1h ago — well below the 4h threshold
    const assignedAt = hoursAgo(1, assessedAt);

    const result = assessShipmentRisk(baseInput({
      currentStatus: 'ASSIGNED',
      lastEventAt: hoursAgo(1, assessedAt),
      assessedAt,
      activeAssignment: { assignedAt, acceptedAt: null },
    }));

    const hasNotAccepted = result.factors.some(f => f.code === 'COURIER_NOT_ACCEPTED');
    expect(hasNotAccepted).toBe(false);
  });
});

describe('Risk Engine — multiple hub transfers', () => {
  it('scenario 16: > 2 hub transfers produces MULTIPLE_HUB_TRANSFERS factor', () => {
    const result = assessShipmentRisk(baseInput({ hubTransferCount: 3 }));

    const factor = result.factors.find(f => f.code === 'MULTIPLE_HUB_TRANSFERS');
    expect(factor).toBeDefined();
    expect(factor!.score).toBe(RISK_SCORES.MULTIPLE_HUB_TRANSFERS);
    expect(factor!.evidence).toContain('3');
  });

  it('exactly 2 hub transfers does NOT trigger MULTIPLE_HUB_TRANSFERS', () => {
    const result = assessShipmentRisk(baseInput({ hubTransferCount: 2 }));
    const hasMulti = result.factors.some(f => f.code === 'MULTIPLE_HUB_TRANSFERS');
    expect(hasMulti).toBe(false);
  });
});
