import { Router } from 'express';
import express from 'express';
import { authenticate, authorize } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { rateLimiter } from '../../lib/rateLimiter';
import * as controller from './payment.controller';
import { initiatePaymentSchema, initiateStripePaymentSchema } from './payment.schema';
import { z } from 'zod';

const router = Router();

const shipmentIdParam = z.object({ shipmentId: z.string().cuid() });

// ── Stripe webhook — MUST be registered BEFORE express.json() parser ─────────
// express.raw() captures the raw body Buffer needed for signature verification.
// This route is public (no JWT) — Stripe calls it server-to-server.
router.post(
  '/stripe/webhook',
  express.raw({ type: 'application/json' }),
  controller.stripeWebhook,
);

// ── bKash callback — public, no JWT (bKash redirects browser here) ────────────
router.get('/bkash/callback', controller.bkashCallback);

// ── Authenticated routes ──────────────────────────────────────────────────────

// bKash payment initiation
router.post(
  '/bkash/initiate',
  authenticate,
  rateLimiter('paymentInitiate'),
  authorize('CUSTOMER', 'ADMIN'),
  validateRequest({ body: initiatePaymentSchema }),
  controller.initiatePayment,
);

// Stripe Checkout Session creation
router.post(
  '/stripe/checkout',
  authenticate,
  rateLimiter('paymentInitiate'),
  authorize('CUSTOMER', 'ADMIN'),
  validateRequest({ body: initiateStripePaymentSchema }),
  controller.initiateStripeCheckout,
);

// Get payment status by shipment (CUSTOMER sees own shipment only; ADMIN sees all)
router.get(
  '/shipment/:shipmentId',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  validateRequest({ params: shipmentIdParam }),
  controller.getPaymentByShipment,
);

// Admin: list all payments
router.get(
  '/',
  authenticate,
  authorize('ADMIN'),
  controller.listPayments,
);

export default router;
