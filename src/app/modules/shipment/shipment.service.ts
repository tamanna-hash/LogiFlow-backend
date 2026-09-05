import type { Role, ShipmentStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { calculatePrice } from '../pricing/pricing.service';
import { generateTrackingNumber } from '../../utils/trackingNumber';
import { notDeleted } from '../../utils/notDeleted';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import {
  NotFoundError, AuthorizationError, BadRequestError,
} from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { notifyShipmentCreated, notifyGeneric } from '../notification/notification.service';
import { cacheDel, CacheKeys } from '../../lib/redis';
import {
  CUSTOMER_CANCELLABLE_STATUSES, CUSTOMER_EDITABLE_STATUSES,
  isValidTransition,
} from '../../types/enums';
import type { CreateShipmentInput } from './shipment.schema';

const env = { MAX_DELIVERY_ATTEMPTS: Number(process.env.MAX_DELIVERY_ATTEMPTS ?? 3) };

const shipmentListSelect = {
  id: true, trackingNumber: true, status: true, paymentStatus: true,
  senderName: true, recipientName: true, recipientCity: true,
  deliveryType: true, parcelType: true, price: true,
  createdAt: true, updatedAt: true,
};

const shipmentDetailSelect = {
  ...shipmentListSelect,
  senderPhone: true, senderAddress: true, senderCity: true,
  recipientPhone: true, recipientAddress: true,
  declaredWeightKg: true, actualWeightKg: true,
  description: true, specialInstructions: true,
  deliveryAttemptCount: true, deliveredAt: true, cancelledAt: true,
  cancellationReason: true, returnReason: true,
  originZoneId: true, destinationZoneId: true, currentHubId: true,
  customerId: true,
  items: { select: { id: true, description: true, weightKg: true, quantity: true, parcelType: true } },
  originZone: { select: { name: true, code: true } },
  destinationZone: { select: { name: true, code: true } },
  currentHub: { select: { name: true, city: true } },
};

export async function createShipment(
  input: CreateShipmentInput,
  customerId: string,
  customerEmail: string,
  customerName: string,
) {
  // Validate zones exist
  const [originZone, destZone] = await Promise.all([
    prisma.zone.findUnique({ where: { id: input.originZoneId }, select: { id: true, isActive: true } }),
    prisma.zone.findUnique({ where: { id: input.destinationZoneId }, select: { id: true, isActive: true } }),
  ]);
  if (!originZone?.isActive) throw new BadRequestError('Origin zone is invalid or inactive.');
  if (!destZone?.isActive) throw new BadRequestError('Destination zone is invalid or inactive.');

  // Calculate price server-side
  const priceBreakdown = await calculatePrice({
    originZoneId: input.originZoneId,
    destinationZoneId: input.destinationZoneId,
    deliveryType: input.deliveryType,
    parcelType: input.parcelType,
    weightKg: input.declaredWeightKg,
  });

  const trackingNumber = await generateTrackingNumber();

  const shipment = await prisma.$transaction(async (tx) => {
    const s = await tx.shipment.create({
      data: {
        trackingNumber,
        customerId,
        senderName: input.senderName,
        senderPhone: input.senderPhone,
        senderAddress: input.senderAddress,
        senderCity: input.senderCity,
        originZoneId: input.originZoneId,
        recipientName: input.recipientName,
        recipientPhone: input.recipientPhone,
        recipientAddress: input.recipientAddress,
        recipientCity: input.recipientCity,
        destinationZoneId: input.destinationZoneId,
        deliveryType: input.deliveryType,
        parcelType: input.parcelType,
        declaredWeightKg: input.declaredWeightKg,
        description: input.description,
        specialInstructions: input.specialInstructions,
        price: priceBreakdown.total,
        items: { create: input.items },
      },
      select: { id: true, trackingNumber: true, status: true, price: true, paymentStatus: true },
    });

    await tx.payment.create({
      data: {
        shipmentId: s.id,
        amount: priceBreakdown.total,
        status: 'PENDING',
      },
    });

    await tx.shipmentTrackingEvent.create({
      data: {
        shipmentId: s.id,
        status: 'CREATED',
        description: 'Shipment booked',
        actorId: customerId,
      },
    });

    return s;
  });

  await createAuditLog({ actorId: customerId, action: 'SHIPMENT_CREATED', resourceType: 'Shipment', resourceId: shipment.id });

  // Fire-and-forget notification
  void notifyShipmentCreated({
    userId: customerId,
    email: customerEmail,
    firstName: customerName,
    trackingNumber: shipment.trackingNumber,
    price: priceBreakdown.total.toString(),
    shipmentId: shipment.id,
  });

  return { ...shipment, priceBreakdown };
}

function buildShipmentWhere(role: Role, userId: string, hubId?: string | null, extra?: Record<string, unknown>) {
  const base: Record<string, unknown> = { deletedAt: null, ...extra };

  if (role === 'CUSTOMER') base.customerId = userId;
  else if (role === 'COURIER') {
    base.assignments = { some: { courierProfile: { userId }, status: 'ACTIVE' } };
  } else if (role === 'HUB_MANAGER' && hubId) {
    base.currentHubId = hubId;
  }

  return base;
}

export async function listShipments(
  role: Role, userId: string, hubId: string | null | undefined,
  params: {
    page: number; limit: number; status?: ShipmentStatus; paymentStatus?: string;
    deliveryType?: string; search?: string; sortBy: string; sortOrder: string;
    fromDate?: string; toDate?: string;
  },
) {
  const { page, limit, status, paymentStatus, deliveryType, search, sortBy, sortOrder, fromDate, toDate } = params;

  const extra: Record<string, unknown> = {
    ...(status && { status }),
    ...(paymentStatus && { paymentStatus }),
    ...(deliveryType && { deliveryType }),
    ...((fromDate || toDate) && { createdAt: { ...(fromDate && { gte: new Date(fromDate) }), ...(toDate && { lte: new Date(toDate) }) } }),
    ...(search && {
      OR: [
        { trackingNumber: { contains: search, mode: 'insensitive' } },
        { senderName: { contains: search, mode: 'insensitive' } },
        { recipientName: { contains: search, mode: 'insensitive' } },
        { recipientPhone: { contains: search } },
      ],
    }),
  };

  const where = buildShipmentWhere(role, userId, hubId, extra);

  const [shipments, total] = await Promise.all([
    prisma.shipment.findMany({ where, orderBy: { [sortBy]: sortOrder }, ...getPrismaSkipTake(page, limit), select: shipmentListSelect }),
    prisma.shipment.count({ where }),
  ]);

  return { shipments, meta: buildPaginationMeta(total, page, limit) };
}

export async function getShipmentById(id: string, role: Role, userId: string, hubId?: string | null) {
  const shipment = await prisma.shipment.findUnique({
    where: { id, deletedAt: null },
    select: { ...shipmentDetailSelect },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');

  // Ownership/scope check
  if (role === 'CUSTOMER' && shipment.customerId !== userId) throw new AuthorizationError();
  if (role === 'COURIER') {
    const assigned = await prisma.courierAssignment.findFirst({
      where: { shipmentId: id, courierProfile: { userId }, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!assigned) throw new AuthorizationError();
  }
  if (role === 'HUB_MANAGER' && hubId && shipment.currentHubId !== hubId) throw new AuthorizationError();

  return shipment;
}

export async function updateShipment(
  id: string, input: Partial<CreateShipmentInput>,
  role: Role, userId: string,
) {
  const shipment = await prisma.shipment.findUnique({ where: { id, deletedAt: null }, select: { id: true, status: true, customerId: true } });
  if (!shipment) throw new NotFoundError('Shipment not found.');

  if (role === 'CUSTOMER') {
    if (shipment.customerId !== userId) throw new AuthorizationError();
    if (!CUSTOMER_EDITABLE_STATUSES.includes(shipment.status)) {
      throw new BadRequestError(`Shipment cannot be edited in status: ${shipment.status}`);
    }
  }

  return prisma.shipment.update({ where: { id }, data: input, select: shipmentDetailSelect });
}

export async function cancelShipment(
  id: string, reason: string, role: Role, userId: string,
) {
  const shipment = await prisma.shipment.findUnique({
    where: { id, deletedAt: null },
    select: { id: true, status: true, customerId: true, trackingNumber: true, assignments: { where: { status: 'ACTIVE' }, select: { id: true, courierProfileId: true } } },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');

  if (role === 'CUSTOMER') {
    if (shipment.customerId !== userId) throw new AuthorizationError();
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(shipment.status)) {
      throw new BadRequestError(`You cannot cancel a shipment in status: ${shipment.status}`);
    }
  }

  if (!isValidTransition(shipment.status, 'CANCELLED')) {
    throw new BadRequestError(`Cannot cancel shipment in status: ${shipment.status}`);
  }

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason } });

    // Cancel active assignment and free courier
    if (shipment.assignments.length > 0) {
      const assignment = shipment.assignments[0];
      await tx.courierAssignment.update({ where: { id: assignment.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancellationReason: reason } });
      await tx.courierProfile.update({ where: { id: assignment.courierProfileId }, data: { availability: 'AVAILABLE' } });
    }

    await tx.shipmentTrackingEvent.create({
      data: { shipmentId: id, status: 'CANCELLED', description: `Cancelled: ${reason}`, actorId: userId },
    });
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber), CacheKeys.shipmentTracking(id));
  await createAuditLog({ actorId: userId, action: 'SHIPMENT_CANCELLED', resourceType: 'Shipment', resourceId: id, after: { reason } });
}

export async function requestPickup(
  shipmentId: string, input: { scheduledAt?: string; notes?: string },
  role: Role, userId: string,
) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true, status: true, customerId: true, paymentStatus: true, trackingNumber: true },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');

  if (role === 'CUSTOMER' && shipment.customerId !== userId) throw new AuthorizationError();
  if (shipment.status !== 'CREATED') throw new BadRequestError(`Shipment must be in CREATED status to request pickup. Current: ${shipment.status}`);
  if (shipment.paymentStatus !== 'COMPLETED') throw new BadRequestError('Payment must be completed before requesting pickup.');

  const pickup = await prisma.$transaction(async (tx) => {
    const p = await tx.pickupRequest.create({
      data: {
        shipmentId,
        scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : undefined,
        notes: input.notes,
      },
      select: { id: true, shipmentId: true, status: true, scheduledAt: true, notes: true, requestedAt: true },
    });

    await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'PICKUP_REQUESTED' } });
    await tx.shipmentTrackingEvent.create({
      data: { shipmentId, status: 'PICKUP_REQUESTED', description: 'Pickup requested', actorId: userId },
    });

    return p;
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  await createAuditLog({ actorId: userId, action: 'PICKUP_REQUESTED', resourceType: 'PickupRequest', resourceId: pickup.id });
  return pickup;
}

export async function getShipmentTracking(shipmentId: string, role: Role, userId: string, hubId?: string | null) {
  // Ownership check (reuses getShipmentById logic)
  await getShipmentById(shipmentId, role, userId, hubId);

  return prisma.shipmentTrackingEvent.findMany({
    where: { shipmentId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, description: true, location: true, createdAt: true },
  });
}

export async function initiateReturn(shipmentId: string, reason: string, actorId: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true, status: true, deliveryAttemptCount: true, trackingNumber: true },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (shipment.status !== 'DELIVERY_FAILED') throw new BadRequestError('Return can only be initiated for DELIVERY_FAILED shipments.');

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'RETURN_INITIATED', returnReason: reason } });
    await tx.shipmentTrackingEvent.create({
      data: { shipmentId, status: 'RETURN_INITIATED', description: `Return initiated: ${reason}`, actorId },
    });
  });

  await cacheDel(CacheKeys.tracking(shipment.trackingNumber));
  await createAuditLog({ actorId, action: 'RETURN_INITIATED', resourceType: 'Shipment', resourceId: shipmentId });
}
