import type { AssignmentType, CourierAvailability, Role, ShipmentStatus } from '../../../generated/prisma';import { prisma } from '../../lib/prisma';
import { NotFoundError, BadRequestError, ConflictError, AuthorizationError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { cacheDel, CacheKeys } from '../../lib/redis';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { notDeleted } from '../../utils/notDeleted';
import { isValidTransition } from '../../types/enums';
import type { PrismaTx } from '../../types/prisma';
import { claimShipment, assignmentReversal, releaseCourier } from '../../utils/lifecycle';
import { env } from '../../config/env';

export async function assignCourier(
  input: { shipmentId: string; courierProfileId: string; type: AssignmentType },
  actorId: string, actorRole: Role, actorHubId?: string | null,
) {
  if (actorRole === 'HUB_MANAGER' && !actorHubId) throw new AuthorizationError('No hub assigned.');
  const { assignment, shipment } = await prisma.$transaction(async (tx: PrismaTx) => {
    const shipment = await tx.shipment.findUnique({
      where: { id: input.shipmentId, deletedAt: null },
      include: { originZone: true, customer: { select: { id: true, email: true, firstName: true } } },
    });
    if (!shipment) throw new NotFoundError('Shipment not found.');
    await claimShipment(tx, shipment.id, shipment.status);
    const states: Record<AssignmentType, ShipmentStatus[]> = {
      PICKUP: ['PICKUP_REQUESTED'], DELIVERY: ['AT_DESTINATION_HUB', 'DELIVERY_FAILED'], RETURN: ['RETURN_INITIATED'],
    };
    if (!states[input.type].includes(shipment.status)) throw new BadRequestError('Shipment is not ready for this assignment type.');
    if (shipment.paymentStatus !== 'COMPLETED') throw new BadRequestError('Payment must be completed before assignment.');
    if (input.type === 'DELIVERY' && shipment.deliveryAttemptCount >= env.MAX_DELIVERY_ATTEMPTS) throw new BadRequestError('Maximum delivery attempts reached. Initiate a return.');
    await tx.$queryRaw`SELECT id FROM courier_profiles WHERE id = ${input.courierProfileId} FOR UPDATE`;
    const courier = await tx.courierProfile.findUnique({ where: { id: input.courierProfileId }, include: { user: true } });
    if (!courier || courier.user.role !== 'COURIER' || !courier.user.isActive || courier.user.deletedAt) throw new BadRequestError('Courier account is unavailable.');
    if (actorRole === 'HUB_MANAGER' && (courier.hubId !== actorHubId || (input.type === 'PICKUP' ? shipment.originZone?.hubId : shipment.currentHubId) !== actorHubId)) throw new AuthorizationError('Shipment and courier must belong to your hub.');
    if (courier.availability !== 'AVAILABLE' || await tx.courierAssignment.count({ where: { courierProfileId: courier.id, status: 'ACTIVE' } })) throw new ConflictError('Courier has an active assignment or is unavailable.');
    if (await tx.courierAssignment.count({ where: { shipmentId: shipment.id, status: 'ACTIVE' } })) throw new ConflictError('Shipment already has an active assignment.');
    const next: Record<AssignmentType, ShipmentStatus> = { PICKUP: 'ASSIGNED', DELIVERY: 'OUT_FOR_DELIVERY', RETURN: 'RETURNING' };
    const assignment = await tx.courierAssignment.create({ data: { ...input, assignedBy: actorId }, select: { id: true, shipmentId: true, courierProfileId: true, type: true, status: true, assignedAt: true } });
    await tx.shipment.update({ where: { id: shipment.id }, data: { status: next[input.type] } });
    await tx.courierProfile.update({ where: { id: courier.id }, data: { availability: 'ON_DELIVERY' } });
    if (input.type === 'PICKUP') await tx.pickupRequest.update({ where: { shipmentId: shipment.id }, data: { status: 'ASSIGNED' } });
    await tx.shipmentTrackingEvent.create({ data: { shipmentId: shipment.id, status: next[input.type], description: 'Courier assigned for ' + input.type.toLowerCase(), actorId } });
    await createAuditLog({ actorId, action: 'COURIER_ASSIGNED', resourceType: 'CourierAssignment', resourceId: assignment.id }, tx);
    await tx.notification.createMany({ data: [
      { userId: shipment.customer.id, type: 'COURIER_ASSIGNED', title: 'Courier assigned', message: 'Courier assigned to ' + shipment.trackingNumber, metadata: { shipmentId: shipment.id } },
      { userId: courier.userId, type: 'COURIER_ASSIGNED', title: 'New assignment', message: 'Assigned to ' + shipment.trackingNumber, metadata: { shipmentId: shipment.id } },
    ] });
    return { assignment, shipment };
  });
  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  return assignment;
}

export async function cancelAssignment(assignmentId: string, reason: string, actorId: string) {
  const trackingNumber = await prisma.$transaction(async (tx: PrismaTx) => {
    const assignment = await tx.courierAssignment.findUnique({ where: { id: assignmentId }, include: { shipment: true } });
    if (!assignment) throw new NotFoundError('Assignment not found.');
    if (assignment.status !== 'ACTIVE') throw new BadRequestError('Assignment is not active.');
    const previous = assignmentReversal(assignment.type, assignment.shipment.status);
    await claimShipment(tx, assignment.shipmentId, assignment.shipment.status);
    const changed = await tx.courierAssignment.updateMany({ where: { id: assignmentId, status: 'ACTIVE' }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason } });
    if (changed.count !== 1) throw new ConflictError('Assignment changed. Refresh and try again.');
    await tx.shipment.update({ where: { id: assignment.shipmentId }, data: { status: previous } });
    if (assignment.type === 'PICKUP') await tx.pickupRequest.updateMany({ where: { shipmentId: assignment.shipmentId }, data: { status: 'PENDING' } });
    await releaseCourier(tx, assignment.courierProfileId);
    await tx.shipmentTrackingEvent.create({ data: { shipmentId: assignment.shipmentId, status: previous, description: 'Assignment cancelled: ' + reason, actorId } });
    await createAuditLog({ actorId, action: 'COURIER_ASSIGNMENT_CANCELLED', resourceType: 'CourierAssignment', resourceId: assignmentId }, tx);
    return assignment.shipment.trackingNumber;
  });
  await cacheDel(CacheKeys.tracking(trackingNumber));
}

export async function updateShipmentStatus(shipmentId: string, newStatus: ShipmentStatus, reason: string | undefined, actorId: string, actorRole: Role = 'OPERATIONS_MANAGER') {
  const trackingNumber = await prisma.$transaction(async (tx: PrismaTx) => {
    const shipment = await tx.shipment.findUnique({ where: { id: shipmentId, deletedAt: null }, include: { originZone: { include: { hub: true } }, destinationZone: true, assignments: { where: { status: 'ACTIVE' } } } });
    if (!shipment) throw new NotFoundError('Shipment not found.');
    const valid = isValidTransition(shipment.status, newStatus);
    if (!valid && (actorRole !== 'ADMIN' || !reason?.trim())) throw new BadRequestError('Invalid transition. An admin override requires a reason.');
    // Status-only writes must not bypass payment, assignment, transfer or delivery operations.
    if (!['AT_ORIGIN_HUB', 'RETURNED'].includes(newStatus)) throw new BadRequestError('Use the pickup, assignment, transfer, delivery or cancellation action for this status.');
    await claimShipment(tx, shipmentId, shipment.status);
    if (newStatus === 'AT_ORIGIN_HUB') {
      if (shipment.status !== 'PICKED_UP') throw new BadRequestError('A picked-up shipment is required for hub receipt.');
      if (!shipment.originZone?.hub.isActive || shipment.originZone.hub.deletedAt) throw new BadRequestError('Origin hub is unavailable.');
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: shipment.originZone.hubId === shipment.destinationZone?.hubId ? 'AT_DESTINATION_HUB' : 'AT_ORIGIN_HUB', currentHubId: shipment.originZone.hubId, originHubId: shipment.originZone.hubId } });
    } else {
      if (shipment.status !== 'RETURNING' || !shipment.assignments.some(a => a.type === 'RETURN' && a.acceptedAt)) throw new BadRequestError('An accepted return assignment is required.');
      await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'RETURNED', returnedAt: new Date(), currentHubId: null } });
    }
    for (const assignment of shipment.assignments) {
      await tx.courierAssignment.update({ where: { id: assignment.id }, data: { status: 'COMPLETED' } });
      await releaseCourier(tx, assignment.courierProfileId);
    }
    const updated = await tx.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: { status: true } });
    await tx.shipmentTrackingEvent.create({ data: { shipmentId, status: updated.status, description: reason || (newStatus === 'RETURNED' ? 'Returned to sender' : 'Received at origin hub'), actorId } });
    await createAuditLog({ actorId, action: newStatus === 'RETURNED' ? 'RETURN_COMPLETED' : 'SHIPMENT_STATUS_CHANGED', resourceType: 'Shipment', resourceId: shipmentId, before: { status: shipment.status }, after: { status: updated.status } }, tx);
    await tx.notification.create({ data: { userId: shipment.customerId, type: newStatus === 'RETURNED' ? 'RETURNED' : 'ARRIVED_AT_HUB', title: 'Shipment updated', message: shipment.trackingNumber + ': ' + updated.status, metadata: { shipmentId } } });
    return shipment.trackingNumber;
  });
  await cacheDel(CacheKeys.tracking(trackingNumber));
}

export async function listCouriers(params: {
  page: number; limit: number;
  availability?: string; hubId?: string; search?: string;
  actorRole: Role; actorHubId?: string | null;
}) {
  const { page, limit, availability, hubId, search, actorRole, actorHubId } = params;

  if (actorRole === 'HUB_MANAGER' && !actorHubId) throw new AuthorizationError('No hub assigned.');
  const scopedHubId = actorRole === 'HUB_MANAGER' ? actorHubId ?? undefined : hubId;

  const where = {
    ...(scopedHubId && { hubId: scopedHubId }),
    ...(availability && { availability: availability as CourierAvailability }),
    user: {
      ...notDeleted(),
      isActive: true, role: 'COURIER' as const,
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
  if (actorRole === 'HUB_MANAGER' && !actorHubId) throw new AuthorizationError('No hub assigned.');
  const courier = await prisma.courierProfile.findUnique({
    where: { id: courierProfileId },
    select: { id: true, hubId: true, availability: true },
  });
  if (!courier) throw new NotFoundError('Courier profile not found.');

  if (actorRole === 'HUB_MANAGER' && actorHubId && courier.hubId !== actorHubId) {
    throw new AuthorizationError('You can only update availability for couriers at your hub.');
  }

  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM courier_profiles WHERE id = ${courierProfileId} FOR UPDATE`;
    if (await tx.courierAssignment.count({ where: { courierProfileId, status: 'ACTIVE' } })) throw new BadRequestError('Resolve active assignments before changing availability.');
    await tx.courierProfile.update({ where: { id: courierProfileId }, data: { availability } });
  });
}

export async function listAssignments(params: { page: number; limit: number; status?: import('../../../generated/prisma').AssignmentStatus; type?: AssignmentType }) {
 const where = { status: params.status, type: params.type };
 const [assignments, total] = await Promise.all([
  prisma.courierAssignment.findMany({ where, select: assignmentSelect, orderBy: { assignedAt: 'desc' }, ...getPrismaSkipTake(params.page, params.limit) }),
  prisma.courierAssignment.count({ where }),
 ]);
 return { assignments, meta: buildPaginationMeta(total, params.page, params.limit) };
}
import { assignmentSelect } from '../courier/courier.service';
