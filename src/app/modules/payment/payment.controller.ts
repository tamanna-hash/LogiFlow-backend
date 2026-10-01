import type { Request, Response } from 'express';
import * as paymentService from './payment.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { paginationSchema } from '../../utils/pagination';
import { env } from '../../config/env';

// ── bKash ────────────────────────────────────────────────────────────────────

export async function initiatePayment(req: Request, res: Response): Promise<void> {
  const result = await paymentService.initiatePayment(req.body.shipmentId, req.user!.id);
  sendCreated(res, result, 'bKash payment initiated');
}

/**
 * bKash callback — browser redirect, not a JSON API.
 * Must always redirect (never return JSON) because bKash opens this in a browser.
 *
 * Frontend expects: /payment/success?shipmentId=<id> or /payment/failure?shipmentId=<id>
 * so we resolve the shipmentId from the payment record before redirecting.
 */
export async function bkashCallback(req: Request, res: Response): Promise<void> {
  const paymentID = req.query.paymentID as string;

  if (!paymentID) {
    res.redirect(`${env.FRONTEND_URL}/payment/failure?reason=missing_payment_id`);
    return;
  }

  try {
    const result = await paymentService.handleBkashCallback(paymentID);
    const shipmentId = result.shipmentId ?? '';
    const shipmentParam = shipmentId ? `?shipmentId=${encodeURIComponent(shipmentId)}` : '';

    if (result.success) {
      res.redirect(`${env.FRONTEND_URL}/payment/success${shipmentParam}`);
    } else {
      res.redirect(`${env.FRONTEND_URL}/payment/failure${shipmentParam}`);
    }
  } catch {
    res.redirect(`${env.FRONTEND_URL}/payment/failure?reason=processing_error`);
  }
}

// ── Stripe ────────────────────────────────────────────────────────────────────

export async function initiateStripeCheckout(req: Request, res: Response): Promise<void> {
  const result = await paymentService.initiateStripeCheckout(req.body.shipmentId, req.user!.id);
  sendCreated(res, result, 'Stripe checkout session created');
}

/**
 * stripeWebhook — receives webhook events from Stripe.
 *
 * IMPORTANT: This route must receive the raw request body (Buffer),
 * not the JSON-parsed body, for webhook signature verification to work.
 * The route is registered with express.raw() in payment.routes.ts.
 */
export async function stripeWebhook(req: Request, res: Response): Promise<void> {
  const signature = req.headers['stripe-signature'];

  if (!signature || typeof signature !== 'string') {
    res.status(400).json({ success: false, message: 'Missing Stripe-Signature header', errors: [] });
    return;
  }

  try {
    const result = await paymentService.handleStripeWebhook(req.body as Buffer, signature);
    res.status(200).json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook processing failed';
    // 400 tells Stripe to not retry — correct for signature failures
    // 500 would cause Stripe to retry
    console.error('[Stripe Webhook] Error:', message);
    res.status(400).json({ success: false, message, errors: [] });
  }
}

// ── Shared ────────────────────────────────────────────────────────────────────

export async function getPaymentByShipment(req: Request, res: Response): Promise<void> {
  const isAdmin = req.user!.role === 'ADMIN';
  const payment = await paymentService.getPaymentByShipment(
    String(req.params.shipmentId),
    req.user!.id,
    isAdmin,
  );
  sendSuccess(res, payment, 'Payment fetched');
}

export async function listPayments(req: Request, res: Response): Promise<void> {
  const { page, limit } = paginationSchema.parse(req.query);
  const { payments, meta } = await paymentService.listPayments({
    page, limit,
    status: req.query.status as string | undefined,
    fromDate: req.query.fromDate as string | undefined,
    toDate: req.query.toDate as string | undefined,
    search: req.query.search as string | undefined,
  });
  sendSuccess(res, payments, 'Payments fetched', 200, meta);
}
