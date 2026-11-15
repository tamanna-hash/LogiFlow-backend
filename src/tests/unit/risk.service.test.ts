/**
 * Unit tests for Day-2 risk service functions
 *
 * Covers:
 *  getRiskOverview  — aggregation, caching, role scoping, empty set
 *  listRiskAssessments — pagination, riskLevel filter, shipmentStatus filter,
 *                        search filter, hub-manager scoping, empty results
 *
 * The Day-1 functions (assessAndPersistRisk, getLatestAssessment,
 * listAssessmentHistory) are exercised by the existing shipment.service.test.ts
 * and do not need retesting here.
 *
 * All DB and Redis calls are intercepted by the global setup.ts mocks.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import { cacheGet, cacheSet } from '../../app/lib/redis';
import { getRiskOverview, listRiskAssessments } from '../../app/modules/shipment-risk/risk.service';
import { NotFoundError } from '../../app/errors';

vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const SHIP_1 = 'clshipment0000000001';
const SHIP_2 = 'clshipment0000000002';
const SHIP_3 = 'clshipment0000000003';

const NOW = new Date('2026-11-14T12:00:00.000Z');
const OLDER = new Date('2026-11-14T10:00:00.000Z');

function makeAssessment(override: Record<string, unknown> = {}) {
  return {
    id: 'classessment00000001',
    shipmentId: SHIP_1,
    riskScore: 55,
    riskLevel: 'MEDIUM',
    assessmentStatus: 'ASSESSED',
    factors: [],
    shipmentStatus: 'DELIVERY_FAILED',
    lastEventAt: OLDER,
    assessedAt: NOW,
    shipment: { trackingNumber: 'LF-20261114-ABCD1234' },
    ...override,
  };
}

// ── getRiskOverview ───────────────────────────────────────────────────────────

describe('getRiskOverview — cache hit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns cached value without touching the DB', async () => {
    const cached = { total: 10, assessed: 8, unassessed: 2, high: 3, medium: 2, low: 3, requiresAttention: 5 };
    vi.mocked(cacheGet).mockResolvedValue(cached as never);

    const result = await getRiskOverview('ADMIN', null);

    expect(result).toEqual(cached);
    // DB must not be touched
    expect(prisma.shipment.findMany).not.toHaveBeenCalled();
  });
});

describe('getRiskOverview — no shipments in scope', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns all-zero overview when there are no shipments', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([] as never);

    const result = await getRiskOverview('OPERATIONS_MANAGER', null);

    expect(result).toEqual({ total: 0, high: 0, medium: 0, low: 0, unassessed: 0, requiresAttention: 0 });
    expect(cacheSet).toHaveBeenCalledOnce();
  });
});

describe('getRiskOverview — ADMIN with mixed risk levels', () => {
  beforeEach(() => vi.clearAllMocks());

  it('correctly bins HIGH, MEDIUM, LOW and counts unassessed', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);

    // 3 shipments in scope: SHIP_1, SHIP_2, SHIP_3
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([
      { id: SHIP_1 }, { id: SHIP_2 }, { id: SHIP_3 },
    ] as never);

    // groupBy returns SHIP_1 and SHIP_2 have assessments; SHIP_3 is unassessed
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([
      { shipmentId: SHIP_1, _max: { assessedAt: NOW } },
      { shipmentId: SHIP_2, _max: { assessedAt: OLDER } },
    ] as never);

    // findFirst returns the latest riskLevel for each
    vi.mocked(prisma.shipmentRiskAssessment.findFirst)
      .mockResolvedValueOnce({ riskLevel: 'HIGH' } as never)   // SHIP_1
      .mockResolvedValueOnce({ riskLevel: 'MEDIUM' } as never); // SHIP_2

    const result = await getRiskOverview('ADMIN', null);

    expect(result.total).toBe(3);
    expect(result.assessed).toBe(2);
    expect(result.unassessed).toBe(1);
    expect(result.high).toBe(1);
    expect(result.medium).toBe(1);
    expect(result.low).toBe(0);
    expect(result.requiresAttention).toBe(2);
    expect(cacheSet).toHaveBeenCalledOnce();
  });
});

describe('getRiskOverview — HUB_MANAGER scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes currentHubId filter to the shipments query', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([{ id: SHIP_1 }] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([
      { shipmentId: SHIP_1, _max: { assessedAt: NOW } },
    ] as never);
    vi.mocked(prisma.shipmentRiskAssessment.findFirst).mockResolvedValue({ riskLevel: 'LOW' } as never);

    await getRiskOverview('HUB_MANAGER', 'hub_abc');

    // The shipment query must include the hub scope
    const shipmentCall = vi.mocked(prisma.shipment.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect((shipmentCall.where as Record<string, unknown>)).toMatchObject({ currentHubId: 'hub_abc' });
  });
});

describe('getRiskOverview — all LOW', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports requiresAttention = 0 when all assessments are LOW', async () => {
    vi.mocked(cacheGet).mockResolvedValue(null);
    vi.mocked(prisma.shipment.findMany).mockResolvedValue([{ id: SHIP_1 }] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([
      { shipmentId: SHIP_1, _max: { assessedAt: NOW } },
    ] as never);
    vi.mocked(prisma.shipmentRiskAssessment.findFirst).mockResolvedValue({ riskLevel: 'LOW' } as never);

    const result = await getRiskOverview('OPERATIONS_MANAGER', null);

    expect(result.low).toBe(1);
    expect(result.requiresAttention).toBe(0);
  });
});

// ── listRiskAssessments ───────────────────────────────────────────────────────

describe('listRiskAssessments — basic pagination', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated assessments with correct meta', async () => {
    const mockAssessment = makeAssessment();
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([mockAssessment] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([{ shipmentId: SHIP_1 }] as never);

    const result = await listRiskAssessments('ADMIN', null, { page: 1, limit: 20 });

    expect(result.assessments).toHaveLength(1);
    expect(result.assessments[0].riskLevel).toBe('MEDIUM');
    expect(result.meta.total).toBe(1);
    expect(result.meta.page).toBe(1);
    expect(result.meta.totalPages).toBe(1);
  });
});

describe('listRiskAssessments — riskLevel filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes riskLevel to Prisma where clause', async () => {
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([] as never);

    await listRiskAssessments('OPERATIONS_MANAGER', null, { page: 1, limit: 20, riskLevel: 'HIGH' });

    const findManyCall = vi.mocked(prisma.shipmentRiskAssessment.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect((findManyCall.where as Record<string, unknown>)).toMatchObject({ riskLevel: 'HIGH' });
  });
});

describe('listRiskAssessments — shipmentStatus filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes shipmentStatus to Prisma where clause', async () => {
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([] as never);

    await listRiskAssessments('ADMIN', null, { page: 1, limit: 20, shipmentStatus: 'DELIVERY_FAILED' });

    const findManyCall = vi.mocked(prisma.shipmentRiskAssessment.findMany).mock.calls[0][0] as Record<string, unknown>;
    expect((findManyCall.where as Record<string, unknown>)).toMatchObject({ shipmentStatus: 'DELIVERY_FAILED' });
  });
});

describe('listRiskAssessments — search filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes tracking number search into shipment relation filter', async () => {
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([] as never);

    await listRiskAssessments('ADMIN', null, { page: 1, limit: 20, search: 'LF-2026' });

    const findManyCall = vi.mocked(prisma.shipmentRiskAssessment.findMany).mock.calls[0][0] as Record<string, unknown>;
    const shipmentFilter = (findManyCall.where as Record<string, unknown>).shipment as Record<string, unknown>;
    expect(shipmentFilter.trackingNumber).toMatchObject({ contains: 'LF-2026' });
  });
});

describe('listRiskAssessments — HUB_MANAGER scoping', () => {
  beforeEach(() => vi.clearAllMocks());

  it('applies currentHubId to the shipment relation filter', async () => {
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([] as never);

    await listRiskAssessments('HUB_MANAGER', 'hub_xyz', { page: 1, limit: 20 });

    const findManyCall = vi.mocked(prisma.shipmentRiskAssessment.findMany).mock.calls[0][0] as Record<string, unknown>;
    const shipmentFilter = (findManyCall.where as Record<string, unknown>).shipment as Record<string, unknown>;
    expect(shipmentFilter).toMatchObject({ currentHubId: 'hub_xyz' });
  });

  it('does NOT apply hub filter for OPERATIONS_MANAGER', async () => {
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([] as never);

    await listRiskAssessments('OPERATIONS_MANAGER', null, { page: 1, limit: 20 });

    const findManyCall = vi.mocked(prisma.shipmentRiskAssessment.findMany).mock.calls[0][0] as Record<string, unknown>;
    const shipmentFilter = (findManyCall.where as Record<string, unknown>).shipment as Record<string, unknown>;
    expect(shipmentFilter).not.toHaveProperty('currentHubId');
  });
});

describe('listRiskAssessments — empty results', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns empty assessments array with zero total when no matches', async () => {
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([] as never);

    const result = await listRiskAssessments('ADMIN', null, { page: 1, limit: 20, riskLevel: 'HIGH' });

    expect(result.assessments).toHaveLength(0);
    expect(result.meta.total).toBe(0);
    expect(result.meta.totalPages).toBe(0);
  });
});

describe('listRiskAssessments — date range filter', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes fromDate and toDate as Date objects to assessedAt filter', async () => {
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([] as never);

    await listRiskAssessments('ADMIN', null, {
      page: 1, limit: 20,
      fromDate: '2026-11-01', toDate: '2026-11-14',
    });

    const findManyCall = vi.mocked(prisma.shipmentRiskAssessment.findMany).mock.calls[0][0] as Record<string, unknown>;
    const where = findManyCall.where as Record<string, unknown>;
    expect(where.assessedAt).toMatchObject({
      gte: new Date('2026-11-01'),
      lte: new Date('2026-11-14'),
    });
  });
});

describe('listRiskAssessments — trackingNumber present in result', () => {
  beforeEach(() => vi.clearAllMocks());

  it('assessment rows include the tracking number via the shipment join', async () => {
    const mockAssessment = makeAssessment({ shipment: { trackingNumber: 'LF-20261114-TESTTRK' } });
    vi.mocked(prisma.shipmentRiskAssessment.findMany).mockResolvedValue([mockAssessment] as never);
    vi.mocked(prisma.shipmentRiskAssessment.groupBy).mockResolvedValue([{ shipmentId: SHIP_1 }] as never);

    const result = await listRiskAssessments('ADMIN', null, { page: 1, limit: 20 });

    expect(result.assessments[0].shipment.trackingNumber).toBe('LF-20261114-TESTTRK');
  });
});

// ── NotFoundError preserved from Day-1 ───────────────────────────────────────

describe('getLatestAssessment — not found (Day-1 regression guard)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws NotFoundError when shipment does not exist', async () => {
    // Import here to avoid circular mock order issues
    const { getLatestAssessment } = await import('../../app/modules/shipment-risk/risk.service');

    vi.mocked(prisma.shipment.findUnique).mockResolvedValue(null as never);

    await expect(getLatestAssessment('nonexistent')).rejects.toThrow(NotFoundError);
  });
});
