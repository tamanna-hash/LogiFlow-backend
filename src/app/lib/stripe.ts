/**
 * stripe.ts — Stripe SDK wrapper.
 *
 * The Stripe client is a lazy singleton so the server starts normally
 * even when STRIPE_SECRET_KEY is not configured.
 *
 * All Stripe operations check isStripeConfigured() first and throw
 * a ServiceUnavailableError with a clear message when keys are absent.
 *
 * SECURITY:
 *  - STRIPE_SECRET_KEY stays server-side only — never sent to the browser.
 *  - STRIPE_PUBLISHABLE_KEY can be forwarded to the frontend if needed.
 *  - Webhook signature verification uses the raw request body (Buffer).
 */

import Stripe from 'stripe';
import { env } from '../config/env';
import { ServiceUnavailableError } from '../errors';

let _stripe: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

function getStripe(): Stripe {
  if (_stripe) return _stripe;

  if (!env.STRIPE_SECRET_KEY) {
    throw new ServiceUnavailableError(
      'Stripe is not configured. Set STRIPE_SECRET_KEY to enable Stripe payments.',
    );
  }

  _stripe = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: '2026-09-30.endive',
    typescript: true,
  });

  return _stripe;
}

// ── Checkout Session ──────────────────────────────────────────────────────────

export interface CreateCheckoutSessionParams {
  paymentId: string;       // our internal payment record id
  shipmentId: string;
  amountCents: number;     // amount in smallest currency unit (paisa for BDT)
  currency: string;        // 'bdt'
  customerEmail: string;
  successUrl: string;      // frontend URL after success
  cancelUrl: string;       // frontend URL after cancel
  metadata?: Record<string, string>;
}

export async function createCheckoutSession(
  params: CreateCheckoutSessionParams,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();

  return stripe.checkout.sessions.create({
    mode: 'payment',
    customer_email: params.customerEmail,
    line_items: [
      {
        price_data: {
          currency: params.currency,
          unit_amount: params.amountCents,
          product_data: {
            name: 'LogiFlow Shipment Payment',
            description: `Payment for shipment ${params.shipmentId}`,
          },
        },
        quantity: 1,
      },
    ],
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    // Metadata is verified server-side in the webhook handler
    metadata: {
      paymentId: params.paymentId,
      shipmentId: params.shipmentId,
      ...params.metadata,
    },
    // Prevent a session from being used after it expires
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60, // 30 minutes
  });
}

// ── Webhook signature verification ───────────────────────────────────────────

/**
 * constructWebhookEvent — verifies the Stripe-Signature header using the
 * raw request body (Buffer). Must receive the unmodified raw body —
 * NOT the JSON-parsed body — for signature verification to succeed.
 */
export function constructWebhookEvent(
  rawBody: Buffer,
  signature: string,
): Stripe.Event {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new ServiceUnavailableError(
      'STRIPE_WEBHOOK_SECRET is not configured. Cannot verify webhook signature.',
    );
  }

  const stripe = getStripe();

  try {
    return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    throw new Error(
      `Webhook signature verification failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ── Expire session (called when user retries after abandoning) ────────────────

/**
 * Expires an open Stripe Checkout Session so a new one can be created.
 * Stripe only allows expiring sessions that are still `open` — already
 * expired/complete sessions are silently ignored.
 */
export async function expireCheckoutSession(sessionId: string): Promise<void> {
  const stripe = getStripe();
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.status === 'open') {
      await stripe.checkout.sessions.expire(sessionId);
    }
  } catch (err) {
    // If the session is already gone / expired on Stripe's side, that's fine
    console.warn(`[Stripe] Could not expire session ${sessionId}:`, err instanceof Error ? err.message : err);
  }
}

// ── Retrieve session (for manual verification if needed) ─────────────────────

export async function retrieveCheckoutSession(
  sessionId: string,
): Promise<Stripe.Checkout.Session> {
  const stripe = getStripe();
  return stripe.checkout.sessions.retrieve(sessionId, {
    expand: ['payment_intent'],
  });
}

// ── Test helper ───────────────────────────────────────────────────────────────

export function _resetStripeClient(): void {
  _stripe = null;
}
