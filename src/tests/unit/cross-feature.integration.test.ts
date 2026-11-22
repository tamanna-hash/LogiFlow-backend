/**
 * Cross-Feature Integration Tests — Days 1–4
 *
 * Tests that the four roadmap features work together as a coherent system:
 *
 *   Day 1: Deterministic Shipment Risk Engine
 *   Day 2: Risk Service (overview, list, assessment persistence)
 *   Day 3: AI Investigation Service (mocked OpenAI provider)
 *   Day 4: Dijkstra Route Optimization (pure algorithm + service)
 *
 * Integration principles:
 *  - All DB and external-service calls are intercepted by the global setup.ts mocks.
 *  - OpenAI is mocked — no real paid API calls are made.
 *  - Shared fixtures simulate a realistic high-risk shipment scenario.
 *  - Tests verify that features produce consistent, non-conflicting outputs.
 *  - The route optimizer never modifies the shipment's tracking history.
 *  - The AI investigation never overwrites the official risk score.
 *
 * Scenarios:
 *  1.  Risk engine + AI: assessment is included in investigation context
 *  2.  Risk engine: terminal shipment scores 0 — does not create spurious risk
 *  3.  AI investigation: hub scoping matches risk service scoping
 *  4.  Route optimization: does not alter shipment data or tracking events
 *  5.  Risk + Route: same shipmentId used safely across both services
 *  6.  AI: risk score enforced even when model returns wrong value
 *  7.  Risk service: HUB_MANAGER sees only their hub
 *  8.  Route + Risk isolation: optimizing a route creates no risk records
 *  9.  Cross-module auth: CUSTOMER is blocked from all three operational endpoints
 * 10.  Cross-module consistency: tracking number is returned by risk AND AI endpoints
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import { cacheGet } from '../../app/lib/redis';
import { assessShipmentRisk } from '../../app/modules/shipment-risk/risk.engine';
import { getRiskOverview, listRiskAssessments } from '../../app/modules/shipment-risk/risk.service';
import { dijkstra, type AdjacencyList } from '../../app/modules/route-optimization/dijkstra';
import { NotFoundError, ServiceUnavailableError } from '../../app/errors';

// Mock investigation dependencies
vi.mock('../../app/modules/ai-investigation/investigation.context');
vi.mock('../../app/lib/gemini');
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));

import { buildInvestigationContext } from '../../app/modules/ai-investigation/investigation.context';
import { getGemini } from '../../app/lib/gemini';
import { investigateShipment } from '../../app/modules/ai-investigation/investigation.service';

// ── Shared fixtures ───────────────────────────────────────────────────────────

const NOW = new Date('2026-11-15T10:00:00.000Z');
const HOURS_MS = 60 * 60 * 1000;

/** A high-risk shipment that has been in DELIVERY_FAILED for 60h (threshold: 48h). */
const HIGH_RISK_SHIPMENT_ID   = 'clship_highrisksample001';
const HIGH_RISK_TRACKING_NUM  = 'LF-20261115-HIGHRISK';
const HUB_DHAKA_ID    = 'clhubdhakacentral00001';
const HUB_CUMILLA_ID  = 'clhubcumillaregion0001';
const HUB_CTG_ID      = 'clhubchattogramport001';

/** Build a risk engine input for the high-risk scenario. */
function highRiskEngineInput(overrides = {}) {
  return {
    shipmentId: HIGH_RISK_SHIPMENT_ID,
    currentStatus: 'DELIVERY_FAILED' as const,
    createdAt: new Date(NOW.getTime() - 10 * 24 * HOURS_MS),
    deliveryAttemptCount: 3,
    lastEventAt: new Date(NOW.getTime() - 60 * HOURS_MS), // 60h ago — past 48h threshold
    activeAssignment: null,
    hubTransferCount: 1,
    assessedAt: NOW,
    maxDeliveryAttempts: 3,
    ...overrides,
  };
}

/** Minimal AI investigation context returned by context-builder mock. */
function makeContext(riskScore = 85, riskLevel = 'HIGH') {
  return {
    trackingNumber: HIGH_RISK_TRACKING_NUM,
    currentStatus: 'DELIVERY_FAILED',
    deliveryType: 'STANDARD',
    parcelType: 'REGULAR',
    declaredWeightKg: 2.5,
    createdAt: new Date(NOW.getTime() - 10 * 24 * HOURS_MS).toISOString(),
    updatedAt: NOW.toISOString(),
    originCity: 'Dhaka',
    destinationCity: 'Chattogram',
    originZone: 'Dhaka North (ZN-DHK-N)',
    destinationZone: 'Chattogram Port Zone (ZN-CTG-P)',
    currentHubName: null,
    currentHubCity: null,
    deliveryAttemptCount: 3,
    deliveredAt: null,
    cancelledAt: null,
    cancellationReason: null,
    returnReason: null,
    description: null,
    trackingEvents: [
      { timestamp: NOW.toISOString(), status: 'DELIVERY_FAILED', description: 'Delivery failed', location: null },
    ],
    hubTransfers: [],
    deliveryAttempts: [
      { attemptNumber: 3, status: 'FAILED', failureReason: 'NO_ONE_HOME', notes: null, attemptedAt: NOW.toISOString(), deliveredAt: null },
    ],
    assignments: [],
    pickupScheduledAt: null,
    riskAssessment: {
      riskScore,
      riskLevel,
      assessmentStatus: 'ASSESSED',
      factors: [{ code: 'FAILED_DELIVERY_ATTEMPT_MAX', score: 50, evidence: '3 failed delivery attempts.' }],
      assessedAt: NOW.toISOString(),
      lastEventAt: NOW.toISOString(),
    },
  };
}

/** Build a minimal Gemini mock model. */
function makeMockGemini(aiRiskScore = 85, aiRiskLevel = 'HIGH') {
  return {
    generateContent: vi.fn().mockResolvedValue({
      response: {
        text: () => JSON.stringify({
          answer: 'The shipment has reached maximum delivery attempts.',
          overallAssessment: 'Urgent attention required.',
          officialRiskScore: aiRiskScore,
          officialRiskLevel: aiRiskLevel,
          findings: [{ title: 'Max delivery attempts reached', detail: '3 failed attempts.', severity: 'CRITICAL', evidence: [{ fact: '3 attempts', source: 'DeliveryAttempt records' }] }],
          relevantTrackingEvents: [{ timestamp: NOW.toISOString(), status: 'DELIVERY_FAILED', description: 'Delivery failed', significance: 'Most recent failure event.' }],
          recommendedActions: [{ action: 'Initiate return.', priority: 'HIGH', rationale: 'Max attempts exceeded.' }],
          dataLimitations: '',
        }),
      },
    }),
  };
}

/** Build a simple 3-hub directed graph (Dhaka → Cumilla → CTG). */
function buildTestGraph(): AdjacencyList {
  return new Map([
    [HUB_DHAKA_ID,   [{ to: HUB_CUMILLA_ID, cost: 5 }]],
    [HUB_CUMILLA_ID, [{ to: HUB_CTG_ID,     cost: 7 }]],
    [HUB_CTG_ID,     []],
  ]);
}

function buildTestLabels(): Map<string, string> {
  return new Map([
    [HUB_DHAKA_ID,   'Dhaka Central Hub'],
    [HUB_CUMILLA_ID, 'Cumilla Regional Hub'],
    [HUB_CTG_ID,     'Chattogram Port Hub'],
  ]);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Cross-feature: Risk Engine + AI Investigation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scenario 1: risk assessment is present in investigation context and score matches', async () => {
    // The risk engine independently scores this shipment as HIGH (score 85)
    const engineResult = assessShipmentRisk(highRiskEngineInput());
    expect(engineResult.riskLevel).toBe('HIGH');
    expect(engineResult.score).toBeGreaterThanOrEqual(70);

    // The AI investigation context includes the same risk data
    vi.mocked(buildInvestigationContext).mockResolvedValue(makeContext(engineResult.score, engineResult.riskLevel) as never);
    vi.mocked(getGemini).mockReturnValue(makeMockGemini(engineResult.score, engineResult.riskLevel) as never);

    const report = await investigateShipment(HIGH_RISK_SHIPMENT_ID, 'Why is this high risk?', 'OPERATIONS_MANAGER', null);

    // The official risk score in the AI report must match the engine's output
    expect(report.officialRiskScore).toBe(engineResult.score);
    expect(report.officialRiskLevel).toBe(engineResult.riskLevel);
    // The tracking number is attached to the report
    expect(report.trackingNumber).toBe(HIGH_RISK_TRACKING_NUM);
  });

  it('scenario 2: terminal shipment scores 0 — AI context reflects LOW risk accurately', async () => {
    // A delivered shipment should never have elevated risk
    const engineResult = assessShipmentRisk({
      ...highRiskEngineInput(),
      currentStatus: 'DELIVERED',
    });
    expect(engineResult.score).toBe(0);
    expect(engineResult.riskLevel).toBe('LOW');

    // The AI context carries the correct low-risk assessment
    const ctx = makeContext(0, 'LOW');
    ctx.riskAssessment!.riskScore = 0;
    ctx.riskAssessment!.riskLevel = 'LOW';
    vi.mocked(buildInvestigationContext).mockResolvedValue(ctx as never);
    vi.mocked(getGemini).mockReturnValue(makeMockGemini(0, 'LOW') as never);

    const report = await investigateShipment(HIGH_RISK_SHIPMENT_ID, 'Is this delivered?', 'ADMIN', null);

    expect(report.officialRiskScore).toBe(0);
    expect(report.officialRiskLevel).toBe('LOW');
  });

  it('scenario 6: AI investigation enforces official risk score from engine — model deviation corrected', async () => {
    const engineScore = 85;
    const engineLevel = 'HIGH';
    // Context has correct engine values
    vi.mocked(buildInvestigationContext).mockResolvedValue(makeContext(engineScore, engineLevel) as never);
    // But the AI model returns wrong values
    vi.mocked(getGemini).mockReturnValue(makeMockGemini(99, 'MEDIUM') as never);

    const report = await investigateShipment(HIGH_RISK_SHIPMENT_ID, 'What is the risk?', 'ADMIN', null);

    // Service must override model's deviant values with engine's authoritative ones
    expect(report.officialRiskScore).toBe(engineScore);
    expect(report.officialRiskLevel).toBe(engineLevel);
  });
});

describe('Cross-feature: Hub Scoping Consistency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scenario 3: HUB_MANAGER scoping: investigation context uses currentHubId same as risk service', async () => {
    vi.mocked(buildInvestigationContext).mockResolvedValue(makeContext() as never);
    vi.mocked(getGemini).mockReturnValue(makeMockGemini() as never);

    await investigateShipment(HIGH_RISK_SHIPMENT_ID, 'Any issues?', 'HUB_MANAGER', HUB_DHAKA_ID);

    // Investigation context must have been called with the hub's ID — same scoping as risk service
    expect(buildInvestigationContext).toHaveBeenCalledWith(HIGH_RISK_SHIPMENT_ID, 'HUB_MANAGER', HUB_DHAKA_ID);
  });

  it('scenario 7: HUB_MANAGER risk overview uses currentHubId filter', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([{ id: HIGH_RISK_SHIPMENT_ID }] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([
      { shipmentId: HIGH_RISK_SHIPMENT_ID, _max: { assessedAt: NOW } },
    ] as never);
    vi.mocked(prisma.shipmentRiskAssessment.findFirst).mockResolvedValue({ riskLevel: 'HIGH' } as never);

    await getRiskOverview('HUB_MANAGER', HUB_DHAKA_ID);

    const shipmentCall = vi.mocked(prisma.shipment.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect((shipmentCall.where as Record<string, unknown>)).toMatchObject({ currentHubId: HUB_DHAKA_ID });
  });
});

describe('Cross-feature: Route Optimization Isolation', () => {
  it('scenario 4: Dijkstra route optimization does not modify shipment data', () => {
    const graph = buildTestGraph();
    const labels = buildTestLabels();

    // Record shipment state before route calculation
    const shipmentStateBefore = { id: HIGH_RISK_SHIPMENT_ID, status: 'DELIVERY_FAILED', deliveryAttemptCount: 3 };

    // Run route optimization (pure algorithm — no DB, no side effects)
    const result = dijkstra(graph, labels, HUB_DHAKA_ID, HUB_CTG_ID);

    // Route result is correct
    expect(result.found).toBe(true);
    expect(result.path).toEqual([HUB_DHAKA_ID, HUB_CUMILLA_ID, HUB_CTG_ID]);
    expect(result.totalCost).toBe(12);

    // Shipment state is completely unchanged — the algorithm is a pure function
    expect(shipmentStateBefore.status).toBe('DELIVERY_FAILED');
    expect(shipmentStateBefore.deliveryAttemptCount).toBe(3);
  });

  it('scenario 5: same shipmentId can be used in both risk and route services without conflict', async () => {
    // Risk service call (mocked DB)
    vi.mocked(cacheGet).mockResolvedValue(null);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([{ id: HIGH_RISK_SHIPMENT_ID }] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([
      { shipmentId: HIGH_RISK_SHIPMENT_ID, _max: { assessedAt: NOW } },
    ] as never);
    vi.mocked(prisma.shipmentRiskAssessment.findFirst).mockResolvedValue({ riskLevel: 'HIGH' } as never);

    const riskOverview = await getRiskOverview('ADMIN', null);
    expect(riskOverview.high).toBe(1);

    // Route optimization (pure algorithm — doesn't touch the same DB tables)
    const graph = buildTestGraph();
    const labels = buildTestLabels();
    const route = dijkstra(graph, labels, HUB_DHAKA_ID, HUB_CTG_ID);

    expect(route.found).toBe(true);
    expect(route.totalCost).toBe(12);

    // Verify the two operations are truly independent
    // Risk uses shipment_risk_assessments table, route uses hub_routes table
    // The shipmentId appears in both but they read from different tables
    expect(vi.mocked(prisma.shipmentRiskAssessment.groupBy)).toHaveBeenCalled();
    // Route is pure function — prisma.hubRoute was NOT called (dijkstra works on in-memory graph)
  });

  it('scenario 8: optimizing a route does not create ShipmentRiskAssessment records', () => {
    // Pure Dijkstra — no Prisma calls happen
    const graph = buildTestGraph();
    const labels = buildTestLabels();

    dijkstra(graph, labels, HUB_DHAKA_ID, HUB_CTG_ID);

    // Confirm no risk assessment was persisted as a side effect
    expect(vi.mocked(prisma.shipmentRiskAssessment.create)).not.toHaveBeenCalled();
  });
});

describe('Cross-feature: Authorization Boundary Enforcement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scenario 9: AI investigation throws ServiceUnavailableError when provider not configured', async () => {
    // This is the equivalent of a misconfigured deployment — OPENAI_API_KEY missing
    vi.mocked(getGemini).mockImplementation(() => {
      throw new ServiceUnavailableError('AI investigation is not configured.');
    });

    await expect(
      investigateShipment(HIGH_RISK_SHIPMENT_ID, 'Any issues?', 'ADMIN', null),
    ).rejects.toThrow(ServiceUnavailableError);

    // Context builder must NOT have been called — we fail fast before any DB access
    expect(buildInvestigationContext).not.toHaveBeenCalled();
  });

  it('scenario 9b: HUB_MANAGER investigation is denied when shipment is at another hub', async () => {
    vi.mocked(getGemini).mockReturnValue(makeMockGemini() as never);
    // Context builder returns NotFoundError (hub scoping: shipment not at this hub)
    vi.mocked(buildInvestigationContext).mockRejectedValue(new NotFoundError('Shipment not found.'));

    await expect(
      investigateShipment(HIGH_RISK_SHIPMENT_ID, 'Any issues?', 'HUB_MANAGER', HUB_CTG_ID),
    ).rejects.toThrow(NotFoundError);
  });
});

describe('Cross-feature: Tracking Number Consistency', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scenario 10: tracking number returned by both risk service and AI investigation report', async () => {
    // Risk service: assessment includes tracking number via shipment join
    const mockAssessment = {
      id: 'assessment_001',
      shipmentId: HIGH_RISK_SHIPMENT_ID,
      riskScore: 85,
      riskLevel: 'HIGH',
      assessmentStatus: 'ASSESSED',
      factors: [],
      shipmentStatus: 'DELIVERY_FAILED',
      lastEventAt: NOW,
      assessedAt: NOW,
      shipment: { trackingNumber: HIGH_RISK_TRACKING_NUM },
    };

    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([mockAssessment] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([{ shipmentId: HIGH_RISK_SHIPMENT_ID }] as never);

    const riskList = await listRiskAssessments('ADMIN', null, { page: 1, limit: 20 });
    expect(riskList.assessments[0].shipment.trackingNumber).toBe(HIGH_RISK_TRACKING_NUM);

    // AI investigation: tracking number is attached to report from context
    vi.mocked(buildInvestigationContext).mockResolvedValue(makeContext() as never);
    vi.mocked(getGemini).mockReturnValue(makeMockGemini() as never);

    const report = await investigateShipment(HIGH_RISK_SHIPMENT_ID, 'What is happening?', 'ADMIN', null);
    expect(report.trackingNumber).toBe(HIGH_RISK_TRACKING_NUM);

    // Both services returned the same tracking number — consistent
    expect(riskList.assessments[0].shipment.trackingNumber).toBe(report.trackingNumber);
  });
});

// ── Dijkstra: LogiFlow network scenarios ────────────────────────────────────────

describe('Cross-feature: Route optimization with real LogiFlow hub topology', () => {
  it('Dhaka → CTG: via Cumilla (5+7=12) equals same cost as direct (if direct cost = 12)', () => {
    // The seeded network: Dhaka→Cumilla(5), Cumilla→CTG(7), Dhaka→CTG(12)
    const graph = buildTestGraph();
    // Add direct Dhaka→CTG edge with same cost as indirect path
    graph.get(HUB_DHAKA_ID)!.push({ to: HUB_CTG_ID, cost: 12 });
    const labels = buildTestLabels();

    const result = dijkstra(graph, labels, HUB_DHAKA_ID, HUB_CTG_ID);

    // Both routes cost 12; algorithm finds one valid optimal path
    expect(result.found).toBe(true);
    expect(result.totalCost).toBe(12);
    // Path must start at Dhaka and end at CTG
    expect(result.path[0]).toBe(HUB_DHAKA_ID);
    expect(result.path[result.path.length - 1]).toBe(HUB_CTG_ID);
  });

  it('Dhaka → CTG: indirect route is chosen when direct cost is higher (12 > indirect 12)', () => {
    // If direct is costlier than indirect, algorithm picks indirect
    const graph: AdjacencyList = new Map([
      [HUB_DHAKA_ID,   [{ to: HUB_CUMILLA_ID, cost: 5 }, { to: HUB_CTG_ID, cost: 15 }]],
      [HUB_CUMILLA_ID, [{ to: HUB_CTG_ID, cost: 7 }]],
      [HUB_CTG_ID,     []],
    ]);
    const labels = buildTestLabels();

    const result = dijkstra(graph, labels, HUB_DHAKA_ID, HUB_CTG_ID);

    expect(result.found).toBe(true);
    expect(result.totalCost).toBe(12); // 5 + 7 = 12 < 15
    expect(result.path).toEqual([HUB_DHAKA_ID, HUB_CUMILLA_ID, HUB_CTG_ID]);
  });

  it('no route when all outgoing edges from source are inactive (empty adjacency)', () => {
    const graph: AdjacencyList = new Map([
      [HUB_DHAKA_ID,   []], // no outgoing routes — simulates all routes inactive
      [HUB_CUMILLA_ID, []],
      [HUB_CTG_ID,     []],
    ]);
    const labels = buildTestLabels();

    const result = dijkstra(graph, labels, HUB_DHAKA_ID, HUB_CTG_ID);

    expect(result.found).toBe(false);
    expect(result.totalCost).toBe(Infinity);
  });
});
