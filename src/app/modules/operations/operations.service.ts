import type { AssignmentType, CourierAvailability, Role, ShipmentStatus } from '@prisma/client';import { prisma } from '../../lib/prisma';
import { NotFoundError, BadRequestError, ConflictError, AuthorizationError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { notifyCourierAssigned, notifyOutForDelivery } from '../notification/notification.service';
import { cacheDel, CacheKeys } from '../../lib/redis';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { notDeleted } from '../../utils/notDeleted';
import { isValidTransition } from '../../types/enums';

export async function assignCourier(
  input: { shipmentId: string; courierProfileId: string; type: AssignmentType },
  actorId: string,
  actorRole: Role,
  actorHubId?: string | null,
) {
  // HUB_MANAGER scope — courier must belong to their hub
  if (actorRole === 'HUB_MANAGER' && actorHubId) {
    const courier = await prisma.courierProfile.findUnique({
      where: { id: input.courierProfileId },
      select: { hubId: true },
    });
    if (!courier || courier.hubId !== actorHubId) {
      throw new AuthorizationError('You can only assign couriers from your own hub.');
    }
  }

  // Fetch shipment
  const shipment = await prisma.shipment.findUnique({
    where: { id: input.shipmentId, deletedAt: null },
    select: {
      id: true, status: true, currentHubId: true, trackingNumber: true,
      customer: { select: { id: true, email: true, firstName: true } },
    },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');

  // Validate shipment state for assignment type
  const validStates: Record<AssignmentType, ShipmentStatus[]> = {
    PICKUP: ['PICKUP_REQUESTED'],
    DELIVERY: ['AT_DESTINATION_HUB'],
    RETURN: ['RETURN_INITIATED'],
  };
  if (!validStates[input.type].includes(shipment.status)) {
    throw new BadRequestError(`Shipment must be in ${validStates[input.type].join(' or ')} for ${input.type} assignment. Current: ${shipment.status}`);
  }

  // Check existing active assignment
  const existingAssignment = await prisma.courierAssignment.findFirst({
    where: { shipmentId: input.shipmentId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (existingAssignment) throw new ConflictError('Shipment already has an active courier assignment.');

  // Transaction: SELECT FOR UPDATE on courier to prevent race condition
  const assignment = await prisma.$transaction(async (tx) => {
    // Lock courier row and check availability
    const courier = await tx.$queryRaw<{ id: string; availability: string }[]>`
      SELECT id, availability FROM courier_profiles WHERE id = ${input.courierProfileId} FOR UPDATE
    `;
    if (!courier[0]) throw new NotFoundError('Courier profile not found.');
    if (courier[0].availability !== 'AVAILABLE') {
      throw new ConflictError('Courier is not available for assignment.');
    }

    // Determine new shipment status
    const newStatus: Record<AssignmentType, ShipmentStatus> = {
      PICKUP: 'ASSIGNED',
      DELIVERY: 'OUT_FOR_DELIVERY',
      RETURN: 'RETURNING',
    };

    const a = await tx.courierAssignment.create({
      data: {
        shipmentId: input.shipmentId,
        courierProfileId: input.courierProfileId,
        type: input.type,
        assignedBy: actorId,
      },
      select: { id: true, shipmentId: true, courierProfileId: true, type: true, status: true, assignedAt: true },
    });

    await tx.shipment.update({ where: { id: input.shipmentId }, data: { status: newStatus[input.type] } });
    await tx.courierProfile.update({ where: { id: input.courierProfileId }, data: { availability: 'ON_DELIVERY' } });
    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: input.shipmentId,
        status: newStatus[input.type],
        description: `Courier assigned for ${input.type.toLowerCase()}`,
        actorId,
      },
    });

    return a;
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  await createAuditLog({ actorId, action: 'COURIER_ASSIGNED', resourceType: 'CourierAssignment', resourceId: assignment.id });

  // Notify customer and courier (find courier userId)
  const courierUser = await prisma.courierProfile.findUnique({
    where: { id: input.courierProfileId },
    select: { userId: true },
  });

  if (courierUser) {
    if (input.type === 'DELIVERY') {
      void notifyOutForDelivery({
        userId: shipment.customer.id,
        email: shipment.customer.email,
        firstName: shipment.customer.firstName,
        trackingNumber: shipment.trackingNumber,
        shipmentId: shipment.id,
      });
    } else {
      void notifyCourierAssigned({
        customerId: shipment.customer.id,
        customerEmail: shipment.customer.email,
        customerName: shipment.customer.firstName,
        courierId: courierUser.userId,
        trackingNumber: shipment.trackingNumber,
        shipmentId: shipment.id,
      });
    }
  }

  return assignment;
}

export async function cancelAssignment(assignmentId: string, reason: string, actorId: string) {
  const assignment = await prisma.courierAssignment.findUnique({
    where: { id: assignmentId },
    select: {
      id: true, status: true, shipmentId: true, courierProfileId: true,
      shipment: { select: { trackingNumber: true } },
    },
  });
  if (!assignment) throw new NotFoundError('Assignment not found.');
  if (assignment.status !== 'ACTIVE') throw new BadRequestError('Assignment is not active.');

  await prisma.$transaction(async (tx) => {
    await tx.courierAssignment.update({
      where: { id: assignmentId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason },
    });
    await tx.shipment.update({ where: { id: assignment.shipmentId }, data: { status: 'PICKUP_REQUESTED' } });
    await tx.courierProfile.update({ where: { id: assignment.courierProfileId }, data: { availability: 'AVAILABLE' } });
  });

  await cacheDel(CacheKeys.tracking(assignment.shipment.trackingNumber));
  await createAuditLog({ actorId, action: 'COURIER_ASSIGNMENT_CANCELLED', resourceType: 'CourierAssignment', resourceId: assignmentId });
}

export async function updateShipmentStatus(
  shipmentId: string,
  newStatus: ShipmentStatus,
  reason: string | undefined,
  actorId: string,
) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true, status: true, trackingNumber: true },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');

  const isOverride = !isValidTransition(shipment.status, newStatus);

  if (isOverride && !reason) {
    throw new BadRequestError('A reason is required when overriding an invalid state transition.');
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: newStatus } });
    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId,
        status: newStatus,
        description: reason ?? `Status updated to ${newStatus}`,
        actorId,
        metadata: isOverride ? { override: true, reason } : undefined,
      },
    });
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  await createAuditLog({
    actorId,
    action: isOverride ? 'SHIPMENT_ADMIN_OVERRIDE' : 'SHIPMENT_STATUS_CHANGED',
    resourceType: 'Shipment',
    resourceId: shipmentId,
    before: { status: shipment.status },
    after: { status: newStatus },
    metadata: { reason, override: isOverride },
  });
}

export async function listCouriers(params: {
  page: number; limit: number;
  availability?: string; hubId?: string; search?: string;
  actorRole: Role; actorHubId?: string | null;
}) {
  const { page, limit, availability, hubId, search, actorRole, actorHubId } = params;

  const scopedHubId = actorRole === 'HUB_MANAGER' ? actorHubId ?? undefined : hubId;

  const where = {
    ...(scopedHubId && { hubId: scopedHubId }),
    ...(availability && { availability: availability as CourierAvailability }),
    user: {
      ...notDeleted(),
      isActive: true,
      ...(search && {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' as const } },
          { lastName: { contains: search, mode: 'insensitive' as const } },
          { email: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    },
  };

  const [couriers, total] = await Promise.all([
    prisma.courierProfile.findMany({
      where,
      orderBy: { user: { firstName: 'asc' } },
      ...getPrismaSkipTake(page, limit),
      select: {
        id: true, availability: true, vehicleType: true, totalDeliveries: true, hubId: true,
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        hub: { select: { name: true, city: true } },
        assignments: { where: { status: 'ACTIVE' }, select: { shipmentId: true, type: true }, take: 1 },
      },
    }),
    prisma.courierProfile.count({ where }),
  ]);

  return { couriers, meta: buildPaginationMeta(total, page, limit) };
}

export async function updateCourierAvailability(
  courierProfileId: string,
  availability: CourierAvailability,
  actorRole: Role,
  actorHubId?: string | null,
) {
  const courier = await prisma.courierProfile.findUnique({
    where: { id: courierProfileId },
    select: { id: true, hubId: true, availability: true },
  });
  if (!courier) throw new NotFoundError('Courier profile not found.');

  if (actorRole === 'HUB_MANAGER' && actorHubId && courier.hubId !== actorHubId) {
    throw new AuthorizationError('You can only update availability for couriers at your hub.');
  }

  await prisma.courierProfile.update({ where: { id: courierProfileId }, data: { availability } });
}
