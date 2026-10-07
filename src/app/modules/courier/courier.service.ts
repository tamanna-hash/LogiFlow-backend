import { prisma } from '../../lib/prisma';
import { NotFoundError, AuthorizationError, BadRequestError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { notifyDelivered, notifyDeliveryFailed } from '../notification/notification.service';
import { cacheDel, CacheKeys } from '../../lib/redis';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { uploadToCloudinary } from '../../lib/cloudinary';
import type { AssignmentStatus, AssignmentType, DeliveryFailureReason } from '../../../generated/prisma';
import type { PrismaTx } from '../../types/prisma';
import { claimShipment, assignmentReversal, releaseCourier } from '../../utils/lifecycle';
import { ConflictError } from '../../errors';

async function getCourierProfile(userId: string) {
  const profile = await prisma.courierProfile.findUnique({
    where: { userId },
    select: { id: true, availability: true, totalDeliveries: true },
  });
  if (!profile) throw new NotFoundError('Courier profile not found.');
  return profile;
}

async function getActiveAssignment(shipmentId: string, courierProfileId: string) {
  const assignment = await prisma.courierAssignment.findFirst({
    where: { shipmentId, courierProfileId, status: 'ACTIVE' },
    select: { id: true, type: true, shipmentId: true, acceptedAt: true },
  });
  if (!assignment) throw new AuthorizationError('No active assignment found for this shipment.');
  return assignment;
}

export async function getAssignments(userId: string, params: { page: number; limit: number; status?: string; type?: string }) {
  const { page, limit, status, type } = params;
  const profile = await getCourierProfile(userId);

  const where = {
    courierProfileId: profile.id,
    ...(status && { status: status as AssignmentStatus }),
    ...(type && { type: type as AssignmentType }),
  };

  const [assignments, total] = await Promise.all([
    prisma.courierAssignment.findMany({
      where,
      orderBy: { assignedAt: 'desc' },
      ...getPrismaSkipTake(page, limit),
      select: assignmentSelect,
    }),
    prisma.courierAssignment.count({ where }),
  ]);

  return { assignments, meta: buildPaginationMeta(total, page, limit) };
}

export async function acceptAssignment(assignmentId: string, userId: string) {
  const profile = await getCourierProfile(userId);
  const assignment = await prisma.courierAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, courierProfileId: true, status: true },
  });
  if (!assignment) throw new NotFoundError('Assignment not found.');
  if (assignment.courierProfileId !== profile.id) throw new AuthorizationError();
  if (assignment.status !== 'ACTIVE') throw new BadRequestError('Assignment is not active.');

  await prisma.$transaction(async tx => {
    const changed = await tx.courierAssignment.updateMany({ where: { id: assignmentId, status: 'ACTIVE', acceptedAt: null }, data: { acceptedAt: new Date() } });
    if (changed.count !== 1) throw new ConflictError('Assignment is already accepted or no longer active.');
    await createAuditLog({ actorId: userId, action: 'COURIER_ASSIGNMENT_ACCEPTED', resourceType: 'CourierAssignment', resourceId: assignmentId }, tx);
  });
}

export async function rejectAssignment(assignmentId: string, userId: string, reason?: string) {
  const profile = await getCourierProfile(userId);
  const trackingNumber = await prisma.$transaction(async tx => {
    const assignment = await tx.courierAssignment.findUnique({ where: { id: assignmentId }, include: { shipment: true } });
    if (!assignment) throw new NotFoundError('Assignment not found.');
    if (assignment.courierProfileId !== profile.id) throw new AuthorizationError();
    if (assignment.status !== 'ACTIVE' || assignment.acceptedAt) throw new BadRequestError('Only an unaccepted active assignment may be rejected.');
    const previous = assignmentReversal(assignment.type, assignment.shipment.status);
    await claimShipment(tx, assignment.shipmentId, assignment.shipment.status);
    const changed = await tx.courierAssignment.updateMany({ where: { id: assignmentId, status: 'ACTIVE', acceptedAt: null }, data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason } });
    if (changed.count !== 1) throw new ConflictError('Assignment changed. Refresh and retry.');
    await tx.shipment.update({ where: { id: assignment.shipmentId }, data: { status: previous } });
    if (assignment.type === 'PICKUP') await tx.pickupRequest.updateMany({ where: { shipmentId: assignment.shipmentId }, data: { status: 'PENDING' } });
    await releaseCourier(tx, profile.id);
    await tx.shipmentTrackingEvent.create({ data: { shipmentId: assignment.shipmentId, status: previous, description: 'Assignment rejected', actorId: userId } });
    await createAuditLog({ actorId: userId, action: 'COURIER_ASSIGNMENT_REJECTED', resourceType: 'CourierAssignment', resourceId: assignmentId }, tx);
    return assignment.shipment.trackingNumber;
  });
  await cacheDel(CacheKeys.tracking(trackingNumber));
}

export async function updateAvailability(userId: string, availability: 'AVAILABLE' | 'UNAVAILABLE') {
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM courier_profiles WHERE "userId" = ${userId} FOR UPDATE`;
    if (await tx.courierAssignment.count({ where: { courierProfile: { userId }, status: 'ACTIVE' } })) throw new BadRequestError('Resolve active assignments before changing availability.');
    const profile = await tx.courierProfile.update({ where: { userId }, data: { availability } });
    await createAuditLog({ actorId: userId, action: 'COURIER_AVAILABILITY_CHANGED', resourceType: 'CourierProfile', resourceId: profile.id, after: { availability } }, tx);
  });
}

export async function confirmPickup(shipmentId: string, userId: string) {
  const profile = await getCourierProfile(userId);
  const assignment = await getActiveAssignment(shipmentId, profile.id);
  if (!assignment.acceptedAt) throw new BadRequestError('Accept the assignment first.');

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true, status: true, trackingNumber: true },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (assignment.type !== 'PICKUP') throw new BadRequestError('A pickup assignment is required.');
  if (shipment.status !== 'ASSIGNED') throw new BadRequestError(`Shipment must be ASSIGNED to confirm pickup. Current: ${shipment.status}`);

  await prisma.$transaction(async (tx: PrismaTx) => {
    await claimShipment(tx, shipmentId, shipment.status);
    const currentAssignment = await tx.courierAssignment.findFirst({ where: { id: assignment.id, status: 'ACTIVE', acceptedAt: { not: null } } });
    if (!currentAssignment) throw new ConflictError('Assignment changed. Refresh and retry.');
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'PICKED_UP' } });
    await tx.courierAssignment.update({ where: { id: assignment.id }, data: { pickedUpAt: new Date() } });
    await tx.shipmentTrackingEvent.create({
      data: { shipmentId, status: 'PICKED_UP', description: 'Parcel picked up by courier', actorId: userId },
    });
    await tx.pickupRequest.updateMany({ where: { shipmentId }, data: { status: 'COMPLETED', completedAt: new Date() } });
await createAuditLog({ actorId: userId, action: 'PICKUP_COMPLETED', resourceType: 'Shipment', resourceId: shipmentId }, tx);
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
}

export async function recordDelivery(shipmentId: string, userId: string, notes?: string, proofBuffer?: Buffer) {
  const profile = await getCourierProfile(userId);
  const assignment = await getActiveAssignment(shipmentId, profile.id);
  if (!assignment.acceptedAt) throw new BadRequestError('Accept the assignment first.');

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: {
      id: true, status: true, trackingNumber: true,
      customer: { select: { id: true, email: true, firstName: true } },
    },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (assignment.type !== 'DELIVERY') throw new BadRequestError('A delivery assignment is required.');
  if (shipment.status !== 'OUT_FOR_DELIVERY') throw new BadRequestError('Shipment must be OUT_FOR_DELIVERY to record delivery.');

  let proofImageUrl: string | undefined;
  if (proofBuffer) {
    proofImageUrl = await uploadToCloudinary(proofBuffer, 'delivery-proof', `${shipmentId}-proof`);
  }


  await prisma.$transaction(async (tx: PrismaTx) => {
    await claimShipment(tx, shipmentId, shipment.status);
    const currentAssignment = await tx.courierAssignment.findFirst({ where: { id: assignment.id, status: 'ACTIVE', acceptedAt: { not: null } } });
    if (!currentAssignment) throw new ConflictError('Assignment changed. Refresh and retry.');
    const attemptNumber = await tx.deliveryAttempt.count({ where: { shipmentId } });
    await tx.deliveryAttempt.create({
      data: {
        shipmentId,
        courierProfileId: profile.id,
        attemptNumber: attemptNumber + 1,
        status: 'SUCCESS',
        notes,
        deliveredAt: new Date(),
        proofImageUrl,
      },
    });
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'DELIVERED', deliveredAt: new Date(), currentHubId: null, deliveryAttemptCount: { increment: 1 } } });
    await tx.courierAssignment.update({ where: { id: assignment.id }, data: { status: 'COMPLETED', deliveredAt: new Date() } });
    await tx.courierProfile.update({ where: { id: profile.id }, data: { availability: 'AVAILABLE', totalDeliveries: { increment: 1 } } });
    await tx.shipmentTrackingEvent.create({
      data: { shipmentId, status: 'DELIVERED', description: 'Parcel delivered successfully', actorId: userId },
    });
await createAuditLog({ actorId: userId, action: 'DELIVERY_CONFIRMED', resourceType: 'Shipment', resourceId: shipmentId }, tx);
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));

  void notifyDelivered({
    userId: shipment.customer.id,
    email: shipment.customer.email,
    firstName: shipment.customer.firstName,
    trackingNumber: shipment.trackingNumber,
    shipmentId,
  });
}

export async function recordDeliveryFailed(
  shipmentId: string, userId: string,
  failureReason: DeliveryFailureReason, notes?: string,
) {
  const profile = await getCourierProfile(userId);
  const assignment = await getActiveAssignment(shipmentId, profile.id);
  if (!assignment.acceptedAt) throw new BadRequestError('Accept the assignment first.');

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: {
      id: true, status: true, trackingNumber: true, deliveryAttemptCount: true,
      customer: { select: { id: true, email: true, firstName: true } },
    },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (assignment.type !== 'DELIVERY') throw new BadRequestError('A delivery assignment is required.');
  if (shipment.status !== 'OUT_FOR_DELIVERY') throw new BadRequestError('Shipment must be OUT_FOR_DELIVERY.');

  const newAttemptCount = shipment.deliveryAttemptCount + 1;

  await prisma.$transaction(async (tx: PrismaTx) => {
    await claimShipment(tx, shipmentId, shipment.status);
    const currentAssignment = await tx.courierAssignment.findFirst({ where: { id: assignment.id, status: 'ACTIVE', acceptedAt: { not: null } } });
    if (!currentAssignment) throw new ConflictError('Assignment changed. Refresh and retry.');
    const attemptNumber = await tx.deliveryAttempt.count({ where: { shipmentId } });
    await tx.deliveryAttempt.create({
      data: {
        shipmentId,
        courierProfileId: profile.id,
        attemptNumber: attemptNumber + 1,
        status: 'FAILED',
        failureReason,
        notes,
      },
    });
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: 'DELIVERY_FAILED', deliveryAttemptCount: newAttemptCount },
    });
    await tx.courierAssignment.update({ where: { id: assignment.id }, data: { status: 'COMPLETED' } });
    await tx.courierProfile.update({ where: { id: profile.id }, data: { availability: 'AVAILABLE' } });
    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId,
        status: 'DELIVERY_FAILED',
        description: `Delivery failed: ${failureReason.replace(/_/g, ' ')}`,
        actorId: userId,
        metadata: { failureReason, notes },
      },
    });
await createAuditLog({ actorId: userId, action: 'DELIVERY_FAILED', resourceType: 'Shipment', resourceId: shipmentId }, tx);
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));

  void notifyDeliveryFailed({
    userId: shipment.customer.id,
    email: shipment.customer.email,
    firstName: shipment.customer.firstName,
    trackingNumber: shipment.trackingNumber,
    reason: failureReason.replace(/_/g, ' '),
    shipmentId,
  });
}

export async function getEarnings(userId: string, params: { page: number; limit: number; fromDate?: string; toDate?: string }) {
  const { page, limit, fromDate, toDate } = params;
  const profile = await getCourierProfile(userId);

  const where = {
    courierProfileId: profile.id,
    status: 'SUCCESS' as const,
    ...((fromDate || toDate) && {
      attemptedAt: {
        ...(fromDate && { gte: new Date(fromDate) }),
        ...(toDate && { lte: new Date(toDate) }),
      },
    }),
  };

  const [deliveries, total] = await Promise.all([
    prisma.deliveryAttempt.findMany({
      where,
      orderBy: { attemptedAt: 'desc' },
      ...getPrismaSkipTake(page, limit),
      select: {
        id: true, attemptedAt: true, deliveredAt: true,
        shipment: { select: { trackingNumber: true, price: true, recipientCity: true } },
      },
    }),
    prisma.deliveryAttempt.count({ where }),
  ]);

  const totalDeliveries = await prisma.deliveryAttempt.count({ where: { courierProfileId: profile.id, status: 'SUCCESS' } });
  return { deliveries, totalDeliveries, meta: buildPaginationMeta(total, page, limit) };
}

export const assignmentSelect = {
        id: true, type: true, status: true, assignedAt: true, acceptedAt: true,
        pickedUpAt: true, deliveredAt: true,
        shipment: {
          select: {
            id: true, trackingNumber: true, status: true,
            senderName: true, senderAddress: true, senderCity: true, senderPhone: true,
            recipientName: true, recipientAddress: true, recipientCity: true, recipientPhone: true,
          },
        },
      } as const;

export async function getAssignment(id: string, userId: string) {
 const assignment = await prisma.courierAssignment.findFirst({ where: { id, courierProfile: { userId } }, select: assignmentSelect });
 if (!assignment) throw new NotFoundError('Assignment not found.');
 return assignment;
}
