/**
 * hub.assignment.service.test.ts
 *
 * Unit tests for the Hub Manager and Courier Hub assignment services.
 * All Prisma calls are mocked via the global setup in src/tests/setup.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import {
  assignHubManager,
  removeHubManager,
  listUnassignedHubManagers,
  assignCourierHub,
  getHubWithManager,
} from '../../app/modules/hub/hub.service';
import { BadRequestError, NotFoundError } from '../../app/errors';

// Silence audit log writes — they are not under test here
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const HUB_ID   = 'hub_cuid_000001';
const USER_ID  = 'user_cuid_000001';
const ACTOR_ID = 'admin_cuid_00001';

const activeHub = { id: HUB_ID, name: 'Dhaka Central', isActive: true, deletedAt: null };

const hubManagerUser = {
  id: USER_ID,
  role: 'HUB_MANAGER',
  isActive: true,
  deletedAt: null,
  firstName: 'Karim',
  lastName: 'Hussain',
};

const courierUser = {
  id: USER_ID,
  role: 'COURIER',
  isActive: true,
  deletedAt: null,
};

const courierProfile = { id: 'cp_cuid_00001', hubId: null };

// ── getHubWithManager ─────────────────────────────────────────────────────────

describe('HubService — getHubWithManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns hub with manager when hub exists', async () => {
    const hubWithManager = {
      ...activeHub,
      hubManagerProfile: {
        userId: USER_ID,
        user: { id: USER_ID, firstName: 'Karim', lastName: 'Hussain', email: 'hub@test.com', avatarUrl: null },
      },
    };
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(hubWithManager as never);

    const result = await getHubWithManager(HUB_ID);
    expect(result).toEqual(hubWithManager);
    expect(prisma.hub.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: HUB_ID }) }),
    );
  });

  it('returns hub with null manager when no manager assigned', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue({ ...activeHub, hubManagerProfile: null } as never);
    const result = await getHubWithManager(HUB_ID);
    expect(result.hubManagerProfile).toBeNull();
  });

  it('throws NotFoundError when hub does not exist', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(null);
    await expect(getHubWithManager(HUB_ID)).rejects.toThrow(NotFoundError);
  });
});

// ── assignHubManager ──────────────────────────────────────────────────────────

describe('HubService — assignHubManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('successfully assigns a HUB_MANAGER user to an active hub', async () => {
    vi.mocked(prisma.hub.findUnique)
      // First call: validate hub (in assignHubManager)
      .mockResolvedValueOnce(activeHub as never)
      // Second call: inside getHubWithManager after assignment
      .mockResolvedValueOnce({
        ...activeHub,
        hubManagerProfile: {
          userId: USER_ID,
          user: { id: USER_ID, firstName: 'Karim', lastName: 'Hussain', email: 'hub@test.com', avatarUrl: null },
        },
      } as never);

    vi.mocked(prisma.user.findUnique).mockResolvedValue(hubManagerUser as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        hubManagerProfile: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
          upsert: vi.fn().mockResolvedValue({ userId: USER_ID, hubId: HUB_ID }),
        },
      } as never),
    );

    const result = await assignHubManager(HUB_ID, USER_ID, ACTOR_ID);
    expect(result).toBeDefined();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundError when hub does not exist', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(null);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when hub is inactive', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue({ ...activeHub, isActive: false } as never);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when user is soft-deleted', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...hubManagerUser, deletedAt: new Date() } as never);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when user is inactive', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...hubManagerUser, isActive: false } as never);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when user does not have HUB_MANAGER role', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...hubManagerUser, role: 'CUSTOMER' } as never);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when assigning a COURIER role user', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...hubManagerUser, role: 'COURIER' } as never);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when assigning an ADMIN role user', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...hubManagerUser, role: 'ADMIN' } as never);
    await expect(assignHubManager(HUB_ID, USER_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('clears the existing manager before assigning a new one (transaction includes two updateMany)', async () => {
    vi.mocked(prisma.hub.findUnique)
      .mockResolvedValueOnce(activeHub as never)
      .mockResolvedValueOnce({ ...activeHub, hubManagerProfile: { userId: USER_ID, user: {} } } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(hubManagerUser as never);

    const updateManyMock = vi.fn().mockResolvedValue({ count: 1 });
    const upsertMock = vi.fn().mockResolvedValue({ userId: USER_ID, hubId: HUB_ID });

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({ hubManagerProfile: { updateMany: updateManyMock, upsert: upsertMock } } as never),
    );

    await assignHubManager(HUB_ID, USER_ID, ACTOR_ID);

    // Two updateMany calls: one to clear old manager on hub, one to clear user's old hub
    expect(updateManyMock).toHaveBeenCalledTimes(2);
    // One upsert to set the new assignment
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID }, update: { hubId: HUB_ID }, create: { userId: USER_ID, hubId: HUB_ID } }),
    );
  });
});

// ── removeHubManager ──────────────────────────────────────────────────────────

describe('HubService — removeHubManager', () => {
  beforeEach(() => vi.clearAllMocks());

  it('successfully removes hub manager assignment', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.hubManagerProfile.findFirst).mockResolvedValue({ userId: USER_ID } as never);
    vi.mocked(prisma.hubManagerProfile.updateMany).mockResolvedValue({ count: 1 } as never);

    await expect(removeHubManager(HUB_ID, ACTOR_ID)).resolves.not.toThrow();
    expect(prisma.hubManagerProfile.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { hubId: HUB_ID }, data: { hubId: null } }),
    );
  });

  it('throws NotFoundError when hub does not exist', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(null);
    await expect(removeHubManager(HUB_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when hub has no manager to remove', async () => {
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.hubManagerProfile.findFirst).mockResolvedValue(null);
    await expect(removeHubManager(HUB_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });
});

// ── listUnassignedHubManagers ─────────────────────────────────────────────────

describe('HubService — listUnassignedHubManagers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns users with HUB_MANAGER role and null hubId', async () => {
    const unassigned = [
      { id: 'user_01', firstName: 'Alice', lastName: 'A', email: 'a@test.com', avatarUrl: null, hubManagerProfile: { hubId: null } },
      { id: 'user_02', firstName: 'Bob', lastName: 'B', email: 'b@test.com', avatarUrl: null, hubManagerProfile: null },
    ];
    vi.mocked(prisma.user.findMany).mockResolvedValue(unassigned as never);

    const result = await listUnassignedHubManagers();
    expect(result).toHaveLength(2);
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ role: 'HUB_MANAGER', isActive: true }),
      }),
    );
  });

  it('returns empty array when all HUB_MANAGERs are assigned', async () => {
    vi.mocked(prisma.user.findMany).mockResolvedValue([] as never);
    const result = await listUnassignedHubManagers();
    expect(result).toHaveLength(0);
  });
});

// ── assignCourierHub ──────────────────────────────────────────────────────────

describe('HubService — assignCourierHub', () => {
  beforeEach(() => vi.clearAllMocks());

  it('successfully assigns a courier to a hub', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(courierUser as never);
    vi.mocked(prisma.courierProfile.findUnique).mockResolvedValue(courierProfile as never);
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.courierAssignment.count).mockResolvedValue(0);
    vi.mocked(prisma.courierProfile.update).mockResolvedValue({ ...courierProfile, hubId: HUB_ID } as never);

    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).resolves.not.toThrow();
    expect(prisma.courierProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hubId: HUB_ID } }),
    );
  });

  it('successfully unassigns a courier (hubId = null)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(courierUser as never);
    vi.mocked(prisma.courierProfile.findUnique).mockResolvedValue({ ...courierProfile, hubId: HUB_ID } as never);
    vi.mocked(prisma.courierAssignment.count).mockResolvedValue(0);
    vi.mocked(prisma.courierProfile.update).mockResolvedValue({ ...courierProfile, hubId: null } as never);

    await expect(assignCourierHub(USER_ID, null, ACTOR_ID)).resolves.not.toThrow();
    expect(prisma.courierProfile.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { hubId: null } }),
    );
  });

  it('throws NotFoundError when user does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when user is not a COURIER', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...courierUser, role: 'CUSTOMER' } as never);
    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when user is inactive', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...courierUser, isActive: false } as never);
    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('throws NotFoundError when courier profile does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(courierUser as never);
    vi.mocked(prisma.courierProfile.findUnique).mockResolvedValue(null);
    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when target hub does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(courierUser as never);
    vi.mocked(prisma.courierProfile.findUnique).mockResolvedValue(courierProfile as never);
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(null);
    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when target hub is inactive', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(courierUser as never);
    vi.mocked(prisma.courierProfile.findUnique).mockResolvedValue(courierProfile as never);
    vi.mocked(prisma.hub.findUnique).mockResolvedValue({ ...activeHub, isActive: false } as never);
    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when courier has an active assignment', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(courierUser as never);
    vi.mocked(prisma.courierProfile.findUnique).mockResolvedValue({ ...courierProfile, hubId: HUB_ID } as never);
    vi.mocked(prisma.hub.findUnique).mockResolvedValue(activeHub as never);
    vi.mocked(prisma.courierAssignment.count).mockResolvedValue(1);
    await expect(assignCourierHub(USER_ID, 'hub_new_0002', ACTOR_ID)).rejects.toThrow(BadRequestError);
  });

  it('does not check for active assignment when unassigning (hubId = null)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(courierUser as never);
    vi.mocked(prisma.courierProfile.findUnique).mockResolvedValue({ ...courierProfile, hubId: HUB_ID } as never);
    vi.mocked(prisma.courierAssignment.count).mockResolvedValue(0);
    vi.mocked(prisma.courierProfile.update).mockResolvedValue({ ...courierProfile, hubId: null } as never);

    // null hubId → skip hub validation and active-assignment check
    await expect(assignCourierHub(USER_ID, null, ACTOR_ID)).resolves.not.toThrow();
    // hub.findUnique should NOT be called for unassignment
    expect(prisma.hub.findUnique).not.toHaveBeenCalled();
  });

  it('allows assigning a soft-deleted user to throw NotFoundError', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...courierUser, deletedAt: new Date() } as never);
    await expect(assignCourierHub(USER_ID, HUB_ID, ACTOR_ID)).rejects.toThrow(NotFoundError);
  });
});
