import { prisma } from '../../lib/prisma';
import { NotFoundError, ConflictError, BadRequestError, AuthorizationError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { notDeleted } from '../../utils/notDeleted';
import type { CreateHubInput, CreateZoneInput, HubTransferInput } from './hub.schema';
import type { PrismaTx } from '../../types/prisma';
import { claimShipment } from '../../utils/lifecycle';
import { cacheDel, CacheKeys } from '../../lib/redis';

const hubSelect = {
  id: true, name: true, code: true, address: true, city: true,
  phone: true, isActive: true, createdAt: true, updatedAt: true,
};

// ── Hub CRUD ──────────────────────────────────────────────────────────────────

export async function createHub(input: CreateHubInput, actorId: string) {
  const existing = await prisma.hub.findFirst({
    where: { OR: [{ name: input.name }, { code: input.code }], ...notDeleted() },
    select: { id: true },
  });
  if (existing) throw new ConflictError('A hub with this name or code already exists.');

  const hub = await prisma.hub.create({ data: input, select: hubSelect });

  await createAuditLog({ actorId, action: 'HUB_CREATED', resourceType: 'Hub', resourceId: hub.id, after: hub });
  return hub;
}

export async function listHubs(params: {
  page: number; limit: number; isActive?: boolean; search?: string;
  hubId?: string; // for HUB_MANAGER — restrict to own hub
}) {
  const { page, limit, isActive, search, hubId } = params;

  const where = {
    ...notDeleted(),
    ...(hubId && { id: hubId }),
    ...(isActive !== undefined && { isActive }),
    ...(search && {
      OR: [
        { name: { contains: search, mode: 'insensitive' as const } },
        { city: { contains: search, mode: 'insensitive' as const } },
        { code: { contains: search, mode: 'insensitive' as const } },
      ],
    }),
  };

  const [hubs, total] = await Promise.all([
    prisma.hub.findMany({ where, orderBy: { name: 'asc' }, ...getPrismaSkipTake(page, limit), select: hubSelect }),
    prisma.hub.count({ where }),
  ]);

  return { hubs, meta: buildPaginationMeta(total, page, limit) };
}

export async function getHubById(id: string) {
  const hub = await prisma.hub.findUnique({
    where: { id, ...notDeleted() },
    select: {
      ...hubSelect,
      zones: { select: { id: true, name: true, code: true, isActive: true } },
      _count: { select: { shipmentsCurrently: { where: { deletedAt: null, status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } } } } },
      hubManagerProfiles: {
        where: { hubId: { not: null } },
        select: {
          userId: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
        },
      },
    },
  });
  if (!hub) throw new NotFoundError('Hub not found.');
  return hub;
}

export async function updateHub(id: string, input: Partial<CreateHubInput>, actorId: string) {
  const hub = await prisma.hub.findUnique({ where: { id, ...notDeleted() }, select: { id: true } });
  if (!hub) throw new NotFoundError('Hub not found.');

  const updated = await prisma.hub.update({ where: { id }, data: input, select: hubSelect });
  await createAuditLog({ actorId, action: 'HUB_UPDATED', resourceType: 'Hub', resourceId: id, after: input });
  return updated;
}

export async function deactivateHub(id: string, actorId: string) {
  const hub = await prisma.hub.findUnique({ where: { id, ...notDeleted() }, select: { id: true, isActive: true } });
  if (!hub) throw new NotFoundError('Hub not found.');

  // Block if hub has active (non-terminal) shipments
  const activeShipments = await prisma.shipment.count({
    where: {
      currentHubId: id,
      deletedAt: null,
      status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] },
    },
  });
  if (activeShipments > 0) {
    throw new BadRequestError(`Hub has ${activeShipments} active shipment(s). Resolve them before deactivating.`);
  }

  await prisma.hub.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
  await createAuditLog({ actorId, action: 'HUB_DEACTIVATED', resourceType: 'Hub', resourceId: id });
}

// ── Zone CRUD ─────────────────────────────────────────────────────────────────

export async function createZone(input: CreateZoneInput, _actorId: string) {
  const hub = await prisma.hub.findUnique({ where: { id: input.hubId, ...notDeleted() }, select: { id: true } });
  if (!hub) throw new NotFoundError('Hub not found.');

  const existing = await prisma.zone.findUnique({ where: { code: input.code }, select: { id: true } });
  if (existing) throw new ConflictError('A zone with this code already exists.');

  return prisma.zone.create({
    data: input,
    select: { id: true, name: true, code: true, hubId: true, description: true, isActive: true, createdAt: true },
  });
}

export async function listZones(params: { hubId?: string; isActive?: boolean; page: number; limit: number }) {
  const { hubId, isActive, page, limit } = params;
  const where = {
    hub: { isActive: true, deletedAt: null },
    ...(hubId && { hubId }),
    ...(isActive !== undefined && { isActive }),
  };

  const [zones, total] = await Promise.all([
    prisma.zone.findMany({
      where,
      orderBy: { name: 'asc' },
      ...getPrismaSkipTake(page, limit),
      select: { id: true, name: true, code: true, hubId: true, description: true, isActive: true, hub: { select: { name: true, city: true } } },
    }),
    prisma.zone.count({ where }),
  ]);

  return { zones, meta: buildPaginationMeta(total, page, limit) };
}

export async function updateZone(id: string, input: Partial<Omit<CreateZoneInput, 'hubId'>>, _actorId: string) {
  const zone = await prisma.zone.findUnique({ where: { id }, select: { id: true } });
  if (!zone) throw new NotFoundError('Zone not found.');
  return prisma.zone.update({ where: { id }, data: input, select: { id: true, name: true, code: true, isActive: true } });
}

export async function deleteZone(id: string, _actorId: string) {
  const zone = await prisma.zone.findUnique({ where: { id }, select: { id: true } });
  if (!zone) throw new NotFoundError('Zone not found.');

  const used = await prisma.shipment.count({
    where: { OR: [{ originZoneId: id }, { destinationZoneId: id }], status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED'] } },
  });
  if (used > 0) throw new BadRequestError('Zone is in use by active shipments and cannot be deleted.');

  await prisma.zone.update({ where: { id }, data: { isActive: false } });
}

// ── Hub Transfers ─────────────────────────────────────────────────────────────

export async function createHubTransfer(
  hubId: string,
  input: HubTransferInput,
  actorId: string,
  actorRole: string,
  actorHubId?: string | null,
) {
  // HUB_MANAGER scope check
  if (actorRole === 'HUB_MANAGER' && actorHubId !== hubId) {
    throw new AuthorizationError('You can only dispatch transfers from your own hub.');
  }

  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId, deletedAt: null },
    select: { id: true, status: true, currentHubId: true, trackingNumber: true, customerId: true },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');

  if (!['AT_ORIGIN_HUB', 'AT_DESTINATION_HUB'].includes(shipment.status)) {
    throw new BadRequestError(`Shipment must be AT_ORIGIN_HUB or AT_DESTINATION_HUB to transfer. Current: ${shipment.status}`);
  }

  if (shipment.currentHubId !== hubId) {
    throw new BadRequestError('Shipment is not currently at this hub.');
  }

  if (hubId === input.toHubId) throw new BadRequestError('Destination must be a different hub.');
  const destHub = await prisma.hub.findUnique({ where: { id: input.toHubId, isActive: true, ...notDeleted() }, select: { id: true, name: true } });
  if (!destHub) throw new NotFoundError('Destination hub not found.');

  const transfer = await prisma.$transaction(async (tx: PrismaTx) => {
    await claimShipment(tx, shipment.id, shipment.status);
    if (await tx.hubTransfer.count({ where: { shipmentId: shipment.id, status: 'IN_TRANSIT' } })) throw new ConflictError('Shipment already has an active transfer.');
    const t = await tx.hubTransfer.create({
      data: {
        shipmentId: input.shipmentId,
        fromHubId: hubId,
        toHubId: input.toHubId,
        estimatedArrival: input.estimatedArrival ? new Date(input.estimatedArrival) : undefined,
        notes: input.notes,
      },
      select: { id: true, shipmentId: true, fromHubId: true, toHubId: true, status: true, dispatchedAt: true },
    });

    await tx.shipment.update({
      where: { id: input.shipmentId },
      data: { status: 'IN_TRANSIT', currentHubId: null },
    });

    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: input.shipmentId,
        status: 'IN_TRANSIT',
        description: `Dispatched to ${destHub.name}`,
        actorId,
      },
    });

    await createAuditLog({ actorId, action: 'HUB_TRANSFER_CREATED', resourceType: 'HubTransfer', resourceId: t.id }, tx);
    await tx.notification.create({ data: { userId: shipment.customerId, type: 'IN_TRANSIT', title: 'Shipment in transit', message: `${shipment.trackingNumber} is in transit`, metadata: { shipmentId: shipment.id } } });
    return t;
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  return transfer;
}

export async function confirmHubTransferArrival(
  hubId: string,
  transferId: string,
  actorId: string,
  actorRole: string,
  actorHubId?: string | null,
) {
  if (actorRole === 'HUB_MANAGER' && actorHubId !== hubId) {
    throw new AuthorizationError('You can only confirm arrivals at your own hub.');
  }

  const transfer = await prisma.hubTransfer.findUnique({
    where: { id: transferId },
    select: { id: true, shipmentId: true, toHubId: true, status: true, shipment: { select: { trackingNumber: true, status: true, customerId: true } } },
  });
  if (!transfer) throw new NotFoundError('Transfer not found.');
  if (transfer.toHubId !== hubId) throw new BadRequestError('This transfer is not destined for this hub.');
  if (transfer.status !== 'IN_TRANSIT') throw new BadRequestError('Transfer is not in-transit.');

  await prisma.$transaction(async (tx: PrismaTx) => {
    if (transfer.shipment.status !== 'IN_TRANSIT') throw new BadRequestError('Shipment is not in transit.');
    await claimShipment(tx, transfer.shipmentId, 'IN_TRANSIT');
    const hub = await tx.hub.findFirst({ where: { id: hubId, isActive: true, deletedAt: null } });
    if (!hub) throw new BadRequestError('Destination hub is unavailable.');
    await tx.hubTransfer.update({ where: { id: transferId }, data: { status: 'ARRIVED', arrivedAt: new Date() } });
    await tx.shipment.update({
      where: { id: transfer.shipmentId },
      data: { status: 'AT_DESTINATION_HUB', currentHubId: hubId },
    });
    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: transfer.shipmentId,
        status: 'AT_DESTINATION_HUB',
        description: 'Arrived at destination hub',
        hubId,
        actorId,
      },
    });
    await createAuditLog({ actorId, action: 'HUB_TRANSFER_ARRIVED', resourceType: 'HubTransfer', resourceId: transferId }, tx);
    await tx.notification.create({ data: { userId: transfer.shipment.customerId, type: 'ARRIVED_AT_HUB', title: 'Arrived at hub', message: `${transfer.shipment.trackingNumber} arrived at its destination hub`, metadata: { shipmentId: transfer.shipmentId } } });
  });

  await cacheDel(CacheKeys.tracking(transfer.shipment.trackingNumber));
}

export async function listTransfers(hubId: string, params: { page: number; limit: number; status?: import('../../../generated/prisma').HubTransferStatus }) {
 const where = { OR: [{ fromHubId: hubId }, { toHubId: hubId }], status: params.status };
 const [transfers, total] = await Promise.all([
 prisma.hubTransfer.findMany({ where, orderBy: { dispatchedAt: 'desc' }, ...getPrismaSkipTake(params.page, params.limit), select: { id: true, shipmentId: true, fromHubId: true, toHubId: true, status: true, dispatchedAt: true, arrivedAt: true, shipment: { select: { trackingNumber: true } }, fromHub: { select: { name: true } }, toHub: { select: { name: true } } } }),
 prisma.hubTransfer.count({ where }),
 ]);
 return { transfers, meta: buildPaginationMeta(total, params.page, params.limit) };
}

// ── Hub Manager Assignment ────────────────────────────────────────────────────

/**
 * getHubWithManager — returns hub + all its current managers.
 */
export async function getHubWithManager(hubId: string) {
  const hub = await prisma.hub.findUnique({
    where: { id: hubId, ...notDeleted() },
    select: {
      ...hubSelect,
      hubManagerProfiles: {
        where: { hubId: { not: null } },
        select: {
          userId: true,
          user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true } },
        },
      },
    },
  });
  if (!hub) throw new NotFoundError('Hub not found.');
  return hub;
}

/**
 * assignHubManager — assigns a user as a Hub Manager for a hub.
 *
 * Rules enforced:
 * - Target hub must exist and be active.
 * - Target user must exist, be active, and have role HUB_MANAGER.
 * - If the user is already assigned to this hub, it's a no-op.
 * - If the user is assigned to a DIFFERENT hub, that old assignment is cleared first.
 * - Multiple managers can now be assigned to the same hub.
 */
export async function assignHubManager(hubId: string, userId: string, actorId: string) {
  const hub = await prisma.hub.findUnique({
    where: { id: hubId, ...notDeleted() },
    select: { id: true, name: true, isActive: true },
  });
  if (!hub) throw new NotFoundError('Hub not found.');
  if (!hub.isActive) throw new BadRequestError('Cannot assign a manager to an inactive hub.');

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true, deletedAt: true, firstName: true, lastName: true },
  });
  if (!user || user.deletedAt) throw new NotFoundError('User not found.');
  if (!user.isActive) throw new BadRequestError('Cannot assign an inactive user as Hub Manager.');
  if (user.role !== 'HUB_MANAGER') throw new BadRequestError(`User must have the HUB_MANAGER role. Current role: ${user.role}`);

  // Check if already assigned to this hub
  const existing = await prisma.hubManagerProfile.findFirst({ where: { userId, hubId } });
  if (existing) return getHubWithManager(hubId); // idempotent

  // Clear any previous hub assignment for this user (they can only belong to one hub at a time)
  await prisma.hubManagerProfile.updateMany({
    where: { userId, hubId: { not: hubId } },
    data: { hubId: null },
  });

  // Upsert the profile — set hubId
  await prisma.hubManagerProfile.upsert({
    where: { userId },
    update: { hubId },
    create: { userId, hubId },
  });

  await createAuditLog({
    actorId,
    action: 'HUB_UPDATED',
    resourceType: 'HubManagerProfile',
    resourceId: hubId,
    after: { hubId, userId, managerName: `${user.firstName} ${user.lastName}` },
  });

  return getHubWithManager(hubId);
}

/**
 * removeHubManager — removes a specific manager from a hub by userId.
 * The HubManagerProfile record is kept but hubId is set to null.
 * The user retains the HUB_MANAGER role.
 */
export async function removeHubManager(hubId: string, userId: string, actorId: string) {
  const hub = await prisma.hub.findUnique({ where: { id: hubId, ...notDeleted() }, select: { id: true } });
  if (!hub) throw new NotFoundError('Hub not found.');

  const profile = await prisma.hubManagerProfile.findFirst({ where: { hubId, userId } });
  if (!profile) throw new NotFoundError('This user is not a manager of this hub.');

  await prisma.hubManagerProfile.update({
    where: { id: profile.id },
    data: { hubId: null },
  });

  await createAuditLog({
    actorId,
    action: 'HUB_UPDATED',
    resourceType: 'HubManagerProfile',
    resourceId: hubId,
    before: { hubId, userId },
    after: { hubId: null },
  });
}

/**
 * listUnassignedHubManagers — returns HUB_MANAGER users who have no hub assigned.
 * Used to populate the assignment dropdown.
 */
export async function listUnassignedHubManagers() {
  return prisma.user.findMany({
    where: {
      role: 'HUB_MANAGER',
      isActive: true,
      deletedAt: null,
      // User is "unassigned" if they have no profile or their profile's hubId is null
      OR: [
        { hubManagerProfile: null },
        { hubManagerProfile: { hubId: null } },
      ],
    },
    select: {
      id: true, firstName: true, lastName: true, email: true, avatarUrl: true,
      hubManagerProfile: { select: { hubId: true } },
    },
    orderBy: { firstName: 'asc' },
  });
}

// ── Courier Hub Assignment ────────────────────────────────────────────────────

/**
 * assignCourierHub — assigns (or reassigns) a courier to a hub.
 *
 * Rules:
 * - Target hub must exist and be active.
 * - Target user must have role COURIER, be active, and have a CourierProfile.
 * - Courier must not have an ACTIVE assignment (pickup/delivery in progress).
 * - If courier is already at the same hub, this is a no-op (idempotent).
 */
export async function assignCourierHub(
  courierUserId: string,
  newHubId: string | null,
  actorId: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: courierUserId },
    select: { id: true, role: true, isActive: true, deletedAt: true },
  });
  if (!user || user.deletedAt) throw new NotFoundError('User not found.');
  if (!user.isActive) throw new BadRequestError('Cannot assign an inactive user.');
  if (user.role !== 'COURIER') throw new BadRequestError(`User must have the COURIER role. Current role: ${user.role}`);

  const profile = await prisma.courierProfile.findUnique({
    where: { userId: courierUserId },
    select: { id: true, hubId: true },
  });
  if (!profile) throw new NotFoundError('Courier profile not found.');

  if (newHubId !== null) {
    const hub = await prisma.hub.findUnique({
      where: { id: newHubId, ...notDeleted() },
      select: { id: true, isActive: true },
    });
    if (!hub) throw new NotFoundError('Hub not found.');
    if (!hub.isActive) throw new BadRequestError('Cannot assign a courier to an inactive hub.');
  }

  // Block reassignment if courier has active work in progress
  const hasActiveAssignment = await prisma.courierAssignment.count({
    where: { courierProfileId: profile.id, status: 'ACTIVE' },
  });
  if (hasActiveAssignment > 0) {
    throw new BadRequestError(
      'Courier has an active assignment. Resolve it before reassigning to a different hub.',
    );
  }

  const oldHubId = profile.hubId;

  await prisma.courierProfile.update({
    where: { id: profile.id },
    data: { hubId: newHubId },
  });

  await createAuditLog({
    actorId,
    action: 'COURIER_AVAILABILITY_CHANGED',
    resourceType: 'CourierProfile',
    resourceId: profile.id,
    before: { hubId: oldHubId },
    after: { hubId: newHubId },
  });
}

/**
 * getCouriersByHub — returns all couriers for a hub (admin view).
 */
export async function getCouriersByHub(hubId: string, params: { page: number; limit: number }) {
  const hub = await prisma.hub.findUnique({ where: { id: hubId, ...notDeleted() }, select: { id: true } });
  if (!hub) throw new NotFoundError('Hub not found.');

  const where = { hubId };
  const [couriers, total] = await Promise.all([
    prisma.courierProfile.findMany({
      where,
      orderBy: { user: { firstName: 'asc' } },
      ...getPrismaSkipTake(params.page, params.limit),
      select: {
        id: true, hubId: true, availability: true, vehicleType: true, totalDeliveries: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, avatarUrl: true, isActive: true } },
      },
    }),
    prisma.courierProfile.count({ where }),
  ]);

  return { couriers, meta: buildPaginationMeta(total, params.page, params.limit) };
}
