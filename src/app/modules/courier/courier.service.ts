import { prisma } from '../../lib/prisma';
import { NotFoundError, AuthorizationError, BadRequestError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { notifyDelivered, notifyDeliveryFailed } from '../notification/notification.service';
import { cacheDel, CacheKeys } from '../../lib/redis';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { uploadToCloudinary } from '../../lib/cloudinary';
import type { AssignmentStatus, AssignmentType, DeliveryFailureReason } from '@prisma/client';

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
    select: { id: true, type: true, shipmentId: true },
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
      select: {
        id: true, type: true, status: true, assignedAt: true, acceptedAt: true,
        pickedUpAt: true, deliveredAt: true,
        shipment: {
          select: {
            id: true, trackingNumber: true, status: true,
            recipientName: true, recipientAddress: true, recipientCity: true, recipientPhone: true,
          },
        },
      },
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

  await prisma.courierAssignment.update({ where: { id: assignmentId }, data: { acceptedAt: new Date() } });
  await createAuditLog({ actorId: userId, action: 'COURIER_ASSIGNMENT_ACCEPTED', resourceType: 'CourierAssignment', resourceId: assignmentId });
}

export async function rejectAssignment(assignmentId: string, userId: string, reason?: string) {
  const profile = await getCourierProfile(userId);
  const assignment = await prisma.courierAssignment.findUnique({
    where: { id: assignmentId },
    select: { id: true, courierProfileId: true, status: true, shipmentId: true },
  });
  if (!assignment) throw new NotFoundError('Assignment not found.');
  if (assignment.courierProfileId !== profile.id) throw new AuthorizationError();
  if (assignment.status !== 'ACTIVE') throw new BadRequestError('Assignment is not active.');

  await prisma.$transaction(async (tx) => {
    await tx.courierAssignment.update({
      where: { id: assignmentId },
      data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason },
    });
    await tx.shipment.update({ where: { id: assignment.shipmentId }, data: { status: 'PICKUP_REQUESTED' } });
    await tx.courierProfile.update({ where: { id: profile.id }, data: { availability: 'AVAILABLE' } });
  });

  await createAuditLog({ actorId: userId, action: 'COURIER_ASSIGNMENT_REJECTED', resourceType: 'CourierAssignment', resourceId: assignmentId });
}

export async function updateAvailability(userId: string, availability: 'AVAILABLE' | 'UNAVAILABLE') {
  await prisma.courierProfile.update({ where: { userId }, data: { availability } });
}

export async function confirmPickup(shipmentId: string, userId: string) {
  const profile = await getCourierProfile(userId);
  const assignment = await getActiveAssignment(shipmentId, profile.id);

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: { id: true, status: true, trackingNumber: true },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (shipment.status !== 'ASSIGNED') throw new BadRequestError(`Shipment must be ASSIGNED to confirm pickup. Current: ${shipment.status}`);

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'PICKED_UP' } });
    await tx.courierAssignment.update({ where: { id: assignment.id }, data: { pickedUpAt: new Date() } });
    await tx.shipmentTrackingEvent.create({
      data: { shipmentId, status: 'PICKED_UP', description: 'Parcel picked up by courier', actorId: userId },
    });
    await tx.pickupRequest.updateMany({ where: { shipmentId }, data: { status: 'COMPLETED', completedAt: new Date() } });
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  await createAuditLog({ actorId: userId, action: 'PICKUP_COMPLETED', resourceType: 'Shipment', resourceId: shipmentId });
}

export async function recordDelivery(shipmentId: string, userId: string, notes?: string, proofBuffer?: Buffer) {
  const profile = await getCourierProfile(userId);
  const assignment = await getActiveAssignment(shipmentId, profile.id);

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true, status: true, trackingNumber: true,
      customer: { select: { id: true, email: true, firstName: true } },
    },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (shipment.status !== 'OUT_FOR_DELIVERY') throw new BadRequestError('Shipment must be OUT_FOR_DELIVERY to record delivery.');

  let proofImageUrl: string | undefined;
  if (proofBuffer) {
    proofImageUrl = await uploadToCloudinary(proofBuffer, 'delivery-proof', `${shipmentId}-proof`);
  }

  const attemptNumber = await prisma.deliveryAttempt.count({ where: { shipmentId } });

  await prisma.$transaction(async (tx) => {
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
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    await tx.courierAssignment.update({ where: { id: assignment.id }, data: { status: 'COMPLETED', deliveredAt: new Date() } });
    await tx.courierProfile.update({ where: { id: profile.id }, data: { availability: 'AVAILABLE', totalDeliveries: { increment: 1 } } });
    await tx.shipmentTrackingEvent.create({
      data: { shipmentId, status: 'DELIVERED', description: 'Parcel delivered successfully', actorId: userId },
    });
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  await createAuditLog({ actorId: userId, action: 'DELIVERY_CONFIRMED', resourceType: 'Shipment', resourceId: shipmentId });

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

  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: {
      id: true, status: true, trackingNumber: true, deliveryAttemptCount: true,
      customer: { select: { id: true, email: true, firstName: true } },
    },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (shipment.status !== 'OUT_FOR_DELIVERY') throw new BadRequestError('Shipment must be OUT_FOR_DELIVERY.');

  const newAttemptCount = shipment.deliveryAttemptCount + 1;
  const attemptNumber = await prisma.deliveryAttempt.count({ where: { shipmentId } });

  await prisma.$transaction(async (tx) => {
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
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  await createAuditLog({ actorId: userId, action: 'DELIVERY_FAILED', resourceType: 'Shipment', resourceId: shipmentId });

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

  return { deliveries, totalDeliveries: profile.totalDeliveries, meta: buildPaginationMeta(total, page, limit) };
}
