import { prisma } from '../../lib/prisma';
import { NotFoundError, ConflictError, BadRequestError, AuthorizationError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { notDeleted } from '../../utils/notDeleted';
import type { CreateHubInput, CreateZoneInput, HubTransferInput } from './hub.schema';

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
      _count: { select: { shipmentsCurrently: true } },
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
    ...(hubId && { hubId }),
    ...(isActive !== undefined && { isActive }),
  };

  const [zones, total] = await Promise.all([
    prisma.zone.findMany({
      where,
      orderBy: { name: 'asc' },
      ...getPrismaSkipTake(page, limit),
      select: { id: true, name: true, code: true, hubId: true, description: true, isActive: true, hub: { select: { name: true } } },
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

  const destHub = await prisma.hub.findUnique({ where: { id: input.toHubId, ...notDeleted() }, select: { id: true, name: true } });
  if (!destHub) throw new NotFoundError('Destination hub not found.');

  const transfer = await prisma.$transaction(async (tx) => {
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

    return t;
  });

  await createAuditLog({ actorId, action: 'HUB_TRANSFER_CREATED', resourceType: 'HubTransfer', resourceId: transfer.id });
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
    select: { id: true, shipmentId: true, toHubId: true, status: true, shipment: { select: { trackingNumber: true } } },
  });
  if (!transfer) throw new NotFoundError('Transfer not found.');
  if (transfer.toHubId !== hubId) throw new BadRequestError('This transfer is not destined for this hub.');
  if (transfer.status !== 'IN_TRANSIT') throw new BadRequestError('Transfer is not in-transit.');

  await prisma.$transaction(async (tx) => {
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
  });

  await createAuditLog({ actorId, action: 'HUB_TRANSFER_ARRIVED', resourceType: 'HubTransfer', resourceId: transferId });
}
