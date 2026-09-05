import type { NotificationType } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { sendEmail } from '../../lib/resend';
import {
  shipmentCreatedEmail, paymentConfirmedEmail, courierAssignedEmail,
  deliveredEmail, deliveryFailedEmail, outForDeliveryEmail,
} from '../../lib/resend';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { NotFoundError, AuthorizationError } from '../../errors';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, unknown>;
  // Email options — if provided, email is sent alongside in-app notification
  sendEmailTo?: string;
  emailSubject?: string;
  emailHtml?: string;
}

/**
 * createNotification — stores in-app notification record and optionally sends email.
 * Email failures are non-fatal (sendEmail swallows errors internally).
 */
export async function createNotification(input: CreateNotificationInput): Promise<void> {
  await prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      message: input.message,
      metadata: input.metadata,
    },
  });

  if (input.sendEmailTo && input.emailSubject && input.emailHtml) {
    await sendEmail({
      to: input.sendEmailTo,
      subject: input.emailSubject,
      html: input.emailHtml,
    });
  }
}

export async function notifyShipmentCreated(params: {
  userId: string; email: string; firstName: string;
  trackingNumber: string; price: string; shipmentId: string;
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    type: 'SHIPMENT_CREATED',
    title: 'Shipment Booked',
    message: `Your shipment ${params.trackingNumber} has been booked. Amount due: BDT ${params.price}`,
    metadata: { shipmentId: params.shipmentId, trackingNumber: params.trackingNumber },
    sendEmailTo: params.email,
    emailSubject: 'Shipment Booked — LogiFlow',
    emailHtml: shipmentCreatedEmail({ name: params.firstName, trackingNumber: params.trackingNumber, price: params.price }),
  });
}

export async function notifyPaymentCompleted(params: {
  userId: string; email: string; firstName: string;
  trackingNumber: string; transactionId: string; amount: string; shipmentId: string;
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    type: 'PAYMENT_COMPLETED',
    title: 'Payment Confirmed',
    message: `Payment confirmed for shipment ${params.trackingNumber}. TrxID: ${params.transactionId}`,
    metadata: { shipmentId: params.shipmentId, trackingNumber: params.trackingNumber },
    sendEmailTo: params.email,
    emailSubject: 'Payment Confirmed — LogiFlow',
    emailHtml: paymentConfirmedEmail({ name: params.firstName, trackingNumber: params.trackingNumber, transactionId: params.transactionId, amount: params.amount }),
  });
}

export async function notifyCourierAssigned(params: {
  customerId: string; customerEmail: string; customerName: string;
  courierId: string;
  trackingNumber: string; shipmentId: string;
}): Promise<void> {
  await Promise.all([
    createNotification({
      userId: params.customerId,
      type: 'COURIER_ASSIGNED',
      title: 'Courier Assigned',
      message: `A courier has been assigned to your shipment ${params.trackingNumber}`,
      metadata: { shipmentId: params.shipmentId, trackingNumber: params.trackingNumber },
      sendEmailTo: params.customerEmail,
      emailSubject: 'Courier Assigned — LogiFlow',
      emailHtml: courierAssignedEmail({ name: params.customerName, trackingNumber: params.trackingNumber }),
    }),
    createNotification({
      userId: params.courierId,
      type: 'COURIER_ASSIGNED',
      title: 'New Assignment',
      message: `You have been assigned to shipment ${params.trackingNumber}`,
      metadata: { shipmentId: params.shipmentId, trackingNumber: params.trackingNumber },
    }),
  ]);
}

export async function notifyOutForDelivery(params: {
  userId: string; email: string; firstName: string;
  trackingNumber: string; shipmentId: string;
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    type: 'OUT_FOR_DELIVERY',
    title: 'Out for Delivery',
    message: `Your shipment ${params.trackingNumber} is out for delivery today`,
    metadata: { shipmentId: params.shipmentId, trackingNumber: params.trackingNumber },
    sendEmailTo: params.email,
    emailSubject: 'Out for Delivery — LogiFlow',
    emailHtml: outForDeliveryEmail({ name: params.firstName, trackingNumber: params.trackingNumber }),
  });
}

export async function notifyDelivered(params: {
  userId: string; email: string; firstName: string;
  trackingNumber: string; shipmentId: string;
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    type: 'DELIVERED',
    title: 'Parcel Delivered',
    message: `Your shipment ${params.trackingNumber} has been delivered`,
    metadata: { shipmentId: params.shipmentId, trackingNumber: params.trackingNumber },
    sendEmailTo: params.email,
    emailSubject: 'Parcel Delivered — LogiFlow',
    emailHtml: deliveredEmail({ name: params.firstName, trackingNumber: params.trackingNumber }),
  });
}

export async function notifyDeliveryFailed(params: {
  userId: string; email: string; firstName: string;
  trackingNumber: string; reason: string; shipmentId: string;
}): Promise<void> {
  await createNotification({
    userId: params.userId,
    type: 'DELIVERY_FAILED',
    title: 'Delivery Attempt Failed',
    message: `Delivery attempt for ${params.trackingNumber} failed: ${params.reason}`,
    metadata: { shipmentId: params.shipmentId, trackingNumber: params.trackingNumber, reason: params.reason },
    sendEmailTo: params.email,
    emailSubject: 'Delivery Attempt Failed — LogiFlow',
    emailHtml: deliveryFailedEmail({ name: params.firstName, trackingNumber: params.trackingNumber, reason: params.reason }),
  });
}

export async function notifyGeneric(params: {
  userId: string; type: NotificationType; title: string; message: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await createNotification({ ...params });
}

// ── List & read endpoints ─────────────────────────────────────────────────────

export async function getUserNotifications(
  userId: string,
  params: { page: number; limit: number; isRead?: boolean; type?: NotificationType },
) {
  const { page, limit, isRead, type } = params;
  const where = {
    userId,
    ...(isRead !== undefined && { isRead }),
    ...(type && { type }),
  };

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...getPrismaSkipTake(page, limit),
      select: { id: true, type: true, title: true, message: true, isRead: true, readAt: true, metadata: true, createdAt: true },
    }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, isRead: false } }),
  ]);

  return { notifications, meta: { ...buildPaginationMeta(total, page, limit), unreadCount } };
}

export async function markNotificationRead(id: string, userId: string): Promise<void> {
  const notification = await prisma.notification.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!notification) throw new NotFoundError('Notification not found');
  if (notification.userId !== userId) throw new AuthorizationError();

  await prisma.notification.update({
    where: { id },
    data: { isRead: true, readAt: new Date() },
  });
}

export async function markAllNotificationsRead(userId: string): Promise<number> {
  const result = await prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
  return result.count;
}
