import { prisma } from '../../lib/prisma';
import { createBkashPayment, executeBkashPayment } from '../../lib/bkash';
import { NotFoundError, BadRequestError, AuthorizationError, ConflictError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { notifyPaymentCompleted, notifyGeneric } from '../notification/notification.service';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { env } from '../../config/env';

export async function initiatePayment(shipmentId: string, userId: string) {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: {
      id: true, customerId: true, price: true, status: true, paymentStatus: true, trackingNumber: true,
      customer: { select: { email: true, firstName: true } },
    },
  });
  if (!shipment) throw new NotFoundError('Shipment not found.');
  if (shipment.customerId !== userId) throw new AuthorizationError();
  if (shipment.paymentStatus === 'COMPLETED') throw new BadRequestError('This shipment has already been paid.');
  if (shipment.status !== 'CREATED') throw new BadRequestError('Payment can only be initiated for shipments in CREATED status.');

  // Check for existing pending payment with bKash ID already set (already initiated)
  const existingPayment = await prisma.payment.findFirst({
    where: { shipmentId, status: 'PENDING', bkashPaymentId: { not: null } },
    select: { id: true, bkashPaymentId: true },
  });
  if (existingPayment) throw new ConflictError('A payment for this shipment is already in progress. Complete or cancel it first.');

  // Create or find the PENDING payment record
  const payment = await prisma.payment.upsert({
    where: { id: (await prisma.payment.findFirst({ where: { shipmentId, status: 'PENDING', bkashPaymentId: null }, select: { id: true } }))?.id ?? 'new' },
    create: { shipmentId, amount: shipment.price, status: 'PENDING' },
    update: {},
    select: { id: true, amount: true },
  });

  // Call bKash createpayment
  const bkashResult = await createBkashPayment({
    amount: Number(payment.amount).toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: payment.id,
  });

  // Store bkashPaymentId
  await prisma.payment.update({
    where: { id: payment.id },
    data: { bkashPaymentId: bkashResult.paymentID },
  });

  await createAuditLog({ actorId: userId, action: 'PAYMENT_INITIATED', resourceType: 'Payment', resourceId: payment.id });

  return {
    paymentId: payment.id,
    bkashURL: bkashResult.bkashURL,
    amount: Number(payment.amount).toFixed(2),
  };
}

export async function handleBkashCallback(paymentID: string) {
  // Step 1: Find payment by bKash paymentID
  const payment = await prisma.payment.findFirst({
    where: { bkashPaymentId: paymentID },
    select: {
      id: true, status: true, amount: true, shipmentId: true,
      shipment: {
        select: {
          trackingNumber: true,
          customer: { select: { id: true, email: true, firstName: true } },
        },
      },
    },
  });

  if (!payment) {
    return { success: false, message: 'Payment not found' };
  }

  // Step 2: Idempotency check
  if (payment.status !== 'PENDING') {
    return { success: payment.status === 'COMPLETED', message: `Payment already ${payment.status.toLowerCase()}` };
  }

  // Step 3: Call bKash executepayment (server-side verification)
  const executeResult = await executeBkashPayment(paymentID);

  // Step 4: Validate response
  if (executeResult.transactionStatus !== 'Completed') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    await createAuditLog({ actorId: null, action: 'PAYMENT_FAILED', resourceType: 'Payment', resourceId: payment.id });
    return { success: false, message: 'Payment not completed' };
  }

  // Step 5: Validate amount (security: ensure bKash didn't process different amount)
  const expectedAmount = Number(payment.amount);
  const receivedAmount = parseFloat(executeResult.amount);
  if (Math.abs(expectedAmount - receivedAmount) > 0.01) {
    console.error(`[Payment] Amount mismatch: expected ${expectedAmount}, got ${receivedAmount}`);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failedAt: new Date() } });
    return { success: false, message: 'Payment amount mismatch' };
  }

  // Step 6: Validate merchantInvoiceNumber matches
  if (executeResult.merchantInvoiceNumber !== payment.id) {
    console.error('[Payment] merchantInvoiceNumber mismatch');
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failedAt: new Date() } });
    return { success: false, message: 'Invoice number mismatch' };
  }

  // Step 7: Atomic update of payment + shipment
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        bkashTransactionId: executeResult.trxID,
        bkashExecuteResponse: executeResult as object,
        paidAt: new Date(),
      },
    });
    await tx.shipment.update({
      where: { id: payment.shipmentId },
      data: { paymentStatus: 'COMPLETED' },
    });
  });

  await createAuditLog({ actorId: null, action: 'PAYMENT_COMPLETED', resourceType: 'Payment', resourceId: payment.id, after: { trxID: executeResult.trxID } });

  void notifyPaymentCompleted({
    userId: payment.shipment.customer.id,
    email: payment.shipment.customer.email,
    firstName: payment.shipment.customer.firstName,
    trackingNumber: payment.shipment.trackingNumber,
    transactionId: executeResult.trxID,
    amount: Number(payment.amount).toFixed(2),
    shipmentId: payment.shipmentId,
  });

  return { success: true, message: 'Payment completed' };
}

export async function getPaymentByShipment(shipmentId: string, userId: string, isAdmin: boolean) {
  const payment = await prisma.payment.findFirst({
    where: { shipmentId },
    select: {
      id: true, amount: true, status: true, paidAt: true, failedAt: true,
      bkashTransactionId: true, createdAt: true, updatedAt: true,
      // Admin sees full response; customer does not
      ...(isAdmin && { bkashExecuteResponse: true, bkashPaymentId: true }),
      shipment: { select: { customerId: true, trackingNumber: true } },
    },
  });
  if (!payment) throw new NotFoundError('Payment not found.');
  if (!isAdmin && payment.shipment.customerId !== userId) throw new AuthorizationError();
  return payment;
}

export async function listPayments(params: {
  page: number; limit: number; status?: string; fromDate?: string; toDate?: string; search?: string;
}) {
  const { page, limit, status, fromDate, toDate, search } = params;
  const where = {
    ...(status && { status }),
    ...((fromDate || toDate) && { createdAt: { ...(fromDate && { gte: new Date(fromDate) }), ...(toDate && { lte: new Date(toDate) }) } }),
    ...(search && { bkashTransactionId: { contains: search } }),
  };

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...getPrismaSkipTake(page, limit),
      select: {
        id: true, amount: true, status: true, bkashTransactionId: true, paidAt: true, createdAt: true,
        shipment: { select: { trackingNumber: true, customer: { select: { firstName: true, lastName: true, email: true } } } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return { payments, meta: buildPaginationMeta(total, page, limit) };
}
