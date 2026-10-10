import { prisma } from '../../lib/prisma';
import { createBkashPayment, executeBkashPayment } from '../../lib/bkash';
import {
  createCheckoutSession,
  constructWebhookEvent,
  isStripeConfigured,
  expireCheckoutSession,
  retrieveCheckoutSession,
} from '../../lib/stripe';
import { NotFoundError, BadRequestError, AuthorizationError, ConflictError, ServiceUnavailableError } from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { notifyPaymentCompleted } from '../notification/notification.service';
import { buildPaginationMeta, getPrismaSkipTake } from '../../utils/pagination';
import { env } from '../../config/env';
import type { PaymentStatus } from '../../../generated/prisma';
import type { PrismaTx } from '../../types/prisma';

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

  // Find existing pending payment without a bKash ID, or create one
  let payment = await prisma.payment.findFirst({
    where: { shipmentId, status: 'PENDING', bkashPaymentId: null },
    select: { id: true, amount: true },
  });

  if (!payment) {
    payment = await prisma.payment.create({
      data: { shipmentId, amount: shipment.price, status: 'PENDING' },
      select: { id: true, amount: true },
    });
  }

  // Call bKash createpayment
  const bkashResult = await createBkashPayment({
    amount: Number(payment.amount).toFixed(2),
    currency: 'BDT',
    intent: 'sale',
    merchantInvoiceNumber: payment.id,
  });

  console.log('[bKash] createpayment response:', JSON.stringify(bkashResult));

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
    return { success: false, message: 'Payment not found', shipmentId: null };
  }

  // Step 2: Idempotency check
  if (payment.status !== 'PENDING') {
    return {
      success: payment.status === 'COMPLETED',
      message: `Payment already ${payment.status.toLowerCase()}`,
      shipmentId: payment.shipmentId,
    };
  }

  // Step 3: Call bKash executepayment (server-side verification)
  const executeResult = await executeBkashPayment(paymentID);

  // Log full bKash response in development to diagnose failures
  console.log('[bKash] executepayment response:', JSON.stringify(executeResult));

  // Step 4: Validate response
  if (executeResult.transactionStatus !== 'Completed') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: { status: 'FAILED', failedAt: new Date() },
    });
    await createAuditLog({ actorId: null, action: 'PAYMENT_FAILED', resourceType: 'Payment', resourceId: payment.id });
    return { success: false, message: 'Payment not completed', shipmentId: payment.shipmentId };
  }

  // Step 5: Validate amount (security: ensure bKash didn't process different amount)
  const expectedAmount = Number(payment.amount);
  const receivedAmount = Number.parseFloat(executeResult.amount);
  if (Math.abs(expectedAmount - receivedAmount) > 0.01) {
    console.error(`[Payment] Amount mismatch: expected ${expectedAmount}, got ${receivedAmount}`);
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failedAt: new Date() } });
    return { success: false, message: 'Payment amount mismatch', shipmentId: payment.shipmentId };
  }

  // Step 6: Validate merchantInvoiceNumber matches
  if (executeResult.merchantInvoiceNumber !== payment.id) {
    console.error('[Payment] merchantInvoiceNumber mismatch');
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failedAt: new Date() } });
    return { success: false, message: 'Invoice number mismatch', shipmentId: payment.shipmentId };
  }

  // Step 7: Atomic update of payment + shipment
  await prisma.$transaction(async (tx: PrismaTx) => {
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

  return { success: true, message: 'Payment completed', shipmentId: payment.shipmentId };
}

export async function getPaymentByShipment(shipmentId: string, userId: string, isAdmin: boolean) {
  const payment = await prisma.payment.findFirst({
    where: { shipmentId },
    select: {
      id: true, amount: true, status: true, provider: true, paidAt: true, failedAt: true,
      bkashTransactionId: true, stripePaymentIntent: true, createdAt: true, updatedAt: true,
      // Admin sees full response; customer does not
      ...(isAdmin && { bkashExecuteResponse: true, bkashPaymentId: true, stripeSessionId: true }),
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
    ...(status && { status: status as PaymentStatus }),
    ...((fromDate || toDate) && { createdAt: { ...(fromDate && { gte: new Date(fromDate) }), ...(toDate && { lte: new Date(toDate) }) } }),
    ...(search && { bkashTransactionId: { contains: search } }),
  };

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      ...getPrismaSkipTake(page, limit),
      select: {
        id: true, amount: true, status: true, provider: true,
        bkashTransactionId: true, stripePaymentIntent: true,
        paidAt: true, createdAt: true,
        shipment: { select: { trackingNumber: true, customer: { select: { firstName: true, lastName: true, email: true } } } },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return { payments, meta: buildPaginationMeta(total, page, limit) };
}

// ── Stripe Checkout ───────────────────────────────────────────────────────────

/**
 * initiateStripeCheckout — creates a Stripe Checkout Session for a shipment.
 *
 * Pre-conditions (same as bKash):
 *  - Shipment must belong to the requesting user
 *  - Status must be CREATED
 *  - paymentStatus must be PENDING
 *  - No existing COMPLETED payment
 *
 * Returns the Stripe Checkout URL for the frontend to redirect to.
 */
export async function initiateStripeCheckout(shipmentId: string, userId: string) {
  if (!isStripeConfigured()) {
    throw new ServiceUnavailableError(
      'Stripe payments are not enabled. Set STRIPE_SECRET_KEY to activate.',
    );
  }

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

  // Check for existing active Stripe session on this shipment.
  // If found, expire the old Stripe session and reuse the payment record
  // so the user can retry after abandoning a checkout page.
  const existingStripePayment = await prisma.payment.findFirst({
    where: { shipmentId, status: 'PENDING', provider: 'STRIPE', stripeSessionId: { not: null } },
    select: { id: true, stripeSessionId: true, amount: true },
  });
  if (existingStripePayment) {
    // Expire the stale session on Stripe's side (no-op if already expired/completed)
    await expireCheckoutSession(existingStripePayment.stripeSessionId!);

    // Create a fresh session reusing the same payment record
    const amountCents = Math.round(Number(existingStripePayment.amount) * 100);
    const frontendUrl = env.FRONTEND_URL;

    const newSession = await createCheckoutSession({
      paymentId: existingStripePayment.id,
      shipmentId,
      amountCents,
      currency: 'bdt',
      customerEmail: shipment.customer.email,
      successUrl: `${frontendUrl}/payment/success?shipmentId=${shipmentId}`,
      cancelUrl: `${frontendUrl}/payment/failure?shipmentId=${shipmentId}`,
    });

    await prisma.payment.update({
      where: { id: existingStripePayment.id },
      data: { stripeSessionId: newSession.id },
    });

    await createAuditLog({
      actorId: userId,
      action: 'PAYMENT_INITIATED',
      resourceType: 'Payment',
      resourceId: existingStripePayment.id,
      metadata: { provider: 'STRIPE', sessionId: newSession.id, retried: true },
    });

    return {
      paymentId: existingStripePayment.id,
      checkoutUrl: newSession.url,
      amount: Number(existingStripePayment.amount).toFixed(2),
    };
  }

  // Find existing pending payment without a Stripe session, or create one
  let payment = await prisma.payment.findFirst({
    where: { shipmentId, status: 'PENDING', provider: 'BKASH', bkashPaymentId: null, stripeSessionId: null },
    select: { id: true, amount: true },
  });

  if (!payment) {
    payment = await prisma.payment.create({
      data: { shipmentId, amount: shipment.price, status: 'PENDING', provider: 'STRIPE' },
      select: { id: true, amount: true },
    });
  } else {
    // Upgrade existing pending payment to Stripe provider
    await prisma.payment.update({
      where: { id: payment.id },
      data: { provider: 'STRIPE' },
    });
  }

  // Amount in smallest unit — BDT uses paisa (1 BDT = 100 paisa)
  const amountCents = Math.round(Number(payment.amount) * 100);
  const frontendUrl = env.FRONTEND_URL;

  const session = await createCheckoutSession({
    paymentId: payment.id,
    shipmentId,
    amountCents,
    currency: 'bdt',
    customerEmail: shipment.customer.email,
    successUrl: `${frontendUrl}/payment/success?shipmentId=${shipmentId}`,
    cancelUrl: `${frontendUrl}/payment/failure?shipmentId=${shipmentId}`,
  });

  // Store the session ID so the webhook handler can look up the payment
  await prisma.payment.update({
    where: { id: payment.id },
    data: { stripeSessionId: session.id },
  });

  await createAuditLog({
    actorId: userId,
    action: 'PAYMENT_INITIATED',
    resourceType: 'Payment',
    resourceId: payment.id,
    metadata: { provider: 'STRIPE', sessionId: session.id },
  });

  return {
    paymentId: payment.id,
    checkoutUrl: session.url,
    amount: Number(payment.amount).toFixed(2),
  };
}

// ── Stripe Manual Verification ───────────────────────────────────────────────

/**
 * verifyStripePayment — polls the Stripe session directly and completes the
 * payment if Stripe reports it as paid. Used as a fallback when the webhook
 * is delayed (e.g. local dev without the Stripe CLI).
 */
export async function verifyStripePayment(shipmentId: string, userId: string) {
  if (!isStripeConfigured()) {
    throw new ServiceUnavailableError('Stripe payments are not enabled.');
  }

  const payment = await prisma.payment.findFirst({
    where: { shipmentId, provider: 'STRIPE' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true, status: true, amount: true, stripeSessionId: true,
      shipment: {
        select: {
          customerId: true, trackingNumber: true,
          customer: { select: { id: true, email: true, firstName: true } },
        },
      },
    },
  });

  if (!payment) throw new NotFoundError('No Stripe payment found for this shipment.');
  if (payment.shipment.customerId !== userId) throw new AuthorizationError();

  // Already settled — nothing to do
  if (payment.status === 'COMPLETED') return { status: 'COMPLETED', alreadyCompleted: true };
  if (payment.status === 'FAILED') return { status: 'FAILED', alreadyCompleted: false };

  if (!payment.stripeSessionId) throw new BadRequestError('No Stripe session found for this payment.');

  // Retrieve the session from Stripe
  const session = await retrieveCheckoutSession(payment.stripeSessionId);

  if (session.payment_status !== 'paid') {
    return { status: payment.status, alreadyCompleted: false };
  }

  // Session is paid but webhook hasn't fired yet — complete it now
  const paymentIntentId =
    typeof session.payment_intent === 'string'
      ? session.payment_intent
      : (session.payment_intent as { id?: string } | null)?.id ?? null;

  await prisma.$transaction(async (tx: PrismaTx) => {
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        status: 'COMPLETED',
        stripePaymentIntent: paymentIntentId,
        paidAt: new Date(),
      },
    });
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { paymentStatus: 'COMPLETED' },
    });
  });

  await createAuditLog({
    actorId: userId,
    action: 'PAYMENT_COMPLETED',
    resourceType: 'Payment',
    resourceId: payment.id,
    after: { provider: 'STRIPE', paymentIntentId, source: 'manual_verify' },
  });

  void notifyPaymentCompleted({
    userId: payment.shipment.customer.id,
    email: payment.shipment.customer.email,
    firstName: payment.shipment.customer.firstName,
    trackingNumber: payment.shipment.trackingNumber,
    transactionId: paymentIntentId ?? payment.stripeSessionId,
    amount: Number(payment.amount).toFixed(2),
    shipmentId,
  });

  return { status: 'COMPLETED', alreadyCompleted: false };
}

// ── Stripe Webhook Handler ────────────────────────────────────────────────────

/**
 * handleStripeWebhook — processes Stripe webhook events securely.
 *
 * Must receive the raw request body Buffer for signature verification.
 * Idempotent: skips processing if the event ID has already been handled.
 * Only processes checkout.session.completed and checkout.session.expired.
 */
export async function handleStripeWebhook(rawBody: Buffer, signature: string) {
  // Throws if signature is invalid — let caller handle the 400 response
  const event = constructWebhookEvent(rawBody, signature);

  // Idempotency check: ignore already-processed events
  const existingPaymentWithEvent = await prisma.payment.findFirst({
    where: { stripeWebhookEventId: event.id },
    select: { id: true },
  });
  if (existingPaymentWithEvent) {
    console.log(`[Stripe Webhook] Event ${event.id} already processed — skipping`);
    return { received: true };
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const sessionId = session.id;

    const payment = await prisma.payment.findFirst({
      where: { stripeSessionId: sessionId },
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
      console.error(`[Stripe Webhook] No payment found for session ${sessionId}`);
      return { received: true };
    }

    // Idempotency — skip if already completed
    if (payment.status === 'COMPLETED') {
      console.log(`[Stripe Webhook] Payment ${payment.id} already COMPLETED`);
      return { received: true };
    }

    // Validate payment amount matches what Stripe reports
    const stripePaidAmount = session.amount_total ?? 0;
    const expectedCents = Math.round(Number(payment.amount) * 100);

    if (Math.abs(stripePaidAmount - expectedCents) > 1) {
      console.error(
        `[Stripe Webhook] Amount mismatch: expected ${expectedCents}, got ${stripePaidAmount}`,
      );
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failedAt: new Date(), stripeWebhookEventId: event.id },
      });
      await createAuditLog({
        actorId: null, action: 'PAYMENT_FAILED', resourceType: 'Payment', resourceId: payment.id,
        metadata: { reason: 'amount_mismatch', provider: 'STRIPE' },
      });
      return { received: true };
    }

    // Validate metadata
    const meta = session.metadata ?? {};
    if (meta.paymentId !== payment.id) {
      console.error(`[Stripe Webhook] Metadata paymentId mismatch for session ${sessionId}`);
      return { received: true };
    }

    // Extract PaymentIntent ID from the session
    const paymentIntentId =
      typeof session.payment_intent === 'string'
        ? session.payment_intent
        : (session.payment_intent as { id?: string } | null)?.id ?? null;

    // Atomic update: mark payment COMPLETED and shipment paymentStatus COMPLETED
    await prisma.$transaction(async (tx: PrismaTx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: 'COMPLETED',
          stripePaymentIntent: paymentIntentId,
          stripeWebhookEventId: event.id,
          paidAt: new Date(),
        },
      });
      await tx.shipment.update({
        where: { id: payment.shipmentId },
        data: { paymentStatus: 'COMPLETED' },
      });
    });

    await createAuditLog({
      actorId: null, action: 'PAYMENT_COMPLETED', resourceType: 'Payment', resourceId: payment.id,
      after: { provider: 'STRIPE', paymentIntentId },
    });

    void notifyPaymentCompleted({
      userId: payment.shipment.customer.id,
      email: payment.shipment.customer.email,
      firstName: payment.shipment.customer.firstName,
      trackingNumber: payment.shipment.trackingNumber,
      transactionId: paymentIntentId ?? session.id,
      amount: Number(payment.amount).toFixed(2),
      shipmentId: payment.shipmentId,
    });

    console.log(`[Stripe Webhook] Payment ${payment.id} completed via Stripe`);
  }

  if (event.type === 'checkout.session.expired') {
    const session = event.data.object;
    const payment = await prisma.payment.findFirst({
      where: { stripeSessionId: session.id, status: 'PENDING' },
      select: { id: true },
    });

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          stripeWebhookEventId: event.id,
        },
      });
      await createAuditLog({
        actorId: null, action: 'PAYMENT_CANCELLED', resourceType: 'Payment', resourceId: payment.id,
        metadata: { provider: 'STRIPE', reason: 'session_expired' },
      });
    }
  }

  // ── payment_intent.payment_failed ──────────────────────────────────────────
  // Fires when a card is declined, insufficient funds, authentication fails, etc.
  // We look up the payment by PaymentIntent ID and mark it FAILED.
  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    const failureMessage =
      paymentIntent.last_payment_error?.message ?? 'Payment failed';
    const failureCode =
      paymentIntent.last_payment_error?.code ?? 'unknown';

    const payment = await prisma.payment.findFirst({
      where: {
        stripePaymentIntent: paymentIntent.id,
        status: 'PENDING',
      },
      select: {
        id: true,
        shipmentId: true,
        shipment: {
          select: {
            trackingNumber: true,
            customer: { select: { id: true, email: true, firstName: true } },
          },
        },
      },
    });

    if (payment) {
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: 'FAILED',
          failedAt: new Date(),
          stripeWebhookEventId: event.id,
        },
      });

      await createAuditLog({
        actorId: null,
        action: 'PAYMENT_FAILED',
        resourceType: 'Payment',
        resourceId: payment.id,
        metadata: {
          provider: 'STRIPE',
          reason: failureCode,
          message: failureMessage,
          paymentIntentId: paymentIntent.id,
        },
      });

      console.error(
        `[Stripe Webhook] Payment ${payment.id} failed — ${failureCode}: ${failureMessage}`,
      );
    }
  }

  return { received: true };
}

