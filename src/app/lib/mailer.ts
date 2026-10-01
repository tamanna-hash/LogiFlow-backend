/**
 * mailer.ts — Centralized email dispatch with provider selection.
 *
 * Set EMAIL_PROVIDER=gmail  → uses Nodemailer with Gmail SMTP (App Password)
 * Set EMAIL_PROVIDER=resend → uses Resend (default, preserves existing behaviour)
 *
 * If SMTP is not configured and provider is gmail, the server still starts —
 * email-dependent operations return a ServiceUnavailableError with a clear message.
 *
 * SECURITY: Never log OTPs, passwords, SMTP credentials, or auth tokens.
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { Resend } from 'resend';
import { env } from '../config/env';

// ── From address ──────────────────────────────────────────────────────────────

function getFromAddress(): string {
  if (env.EMAIL_PROVIDER === 'gmail') {
    return `LogiFlow <${env.SMTP_USER ?? ''}>`;
  }
  return `LogiFlow <${env.RESEND_FROM_EMAIL}>`;
}

// ── Nodemailer transporter (lazy singleton) ────────────────────────────────────

let _nodemailerTransporter: Transporter | null = null;

function getNodemailerTransporter(): Transporter {
  if (_nodemailerTransporter) return _nodemailerTransporter;

  const user = env.SMTP_USER;
  const pass = env.SMTP_PASS;

  if (!user || !pass) {
    throw new Error(
      'Gmail SMTP is not configured. Set SMTP_USER and SMTP_PASS (App Password) in your environment.',
    );
  }

  _nodemailerTransporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE !== 'false', // default TLS on 465
    auth: { user, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 5_000,
    socketTimeout: 15_000,
  });

  return _nodemailerTransporter;
}

// ── Resend client (lazy singleton) ────────────────────────────────────────────

let _resendClient: Resend | null = null;

function getResendClient(): Resend {
  if (_resendClient) return _resendClient;
  _resendClient = new Resend(env.RESEND_API_KEY);
  return _resendClient;
}

// ── Public interface ───────────────────────────────────────────────────────────

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * dispatchEmail — internal dispatch through the configured provider.
 * Throws on failure (use sendEmail or sendEmailCritical for the right behaviour).
 */
async function dispatchEmail(options: SendEmailOptions): Promise<void> {
  const from = getFromAddress();

  if (env.EMAIL_PROVIDER === 'gmail') {
    const transporter = getNodemailerTransporter();
    const info = await transporter.sendMail({
      from,
      to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
      subject: options.subject,
      html: options.html,
      ...(options.text && { text: options.text }),
    });
    // Log message ID only — never log subject or body content
    console.log(`[Mailer/Gmail] Message sent: ${info.messageId}`);
    return;
  }

  // Resend path
  const client = getResendClient();
  const { data, error } = await client.emails.send({
    from,
    to: options.to,
    subject: options.subject,
    html: options.html,
    ...(options.text && { text: options.text }),
  });

  if (error) {
    const msg =
      typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: string }).message)
        : JSON.stringify(error);
    throw new Error(msg);
  }

  console.log(`[Mailer/Resend] Email sent, id: ${data?.id}`);
}

/**
 * sendEmail — non-critical send. Swallows errors (notifications, welcome email).
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  try {
    await dispatchEmail(options);
  } catch (err) {
    // Never log the full options — they may contain OTPs or sensitive content
    console.warn('[Mailer] Non-critical email failed:', err instanceof Error ? err.message : err);
  }
}

/**
 * sendEmailCritical — OTP / auth emails. Throws on failure so the request fails safely.
 */
export async function sendEmailCritical(options: SendEmailOptions): Promise<void> {
  await dispatchEmail(options);
}

// ── Re-export template helpers so callers import from one place ────────────────
// Templates are defined in resend.ts (legacy) and we re-export them here.
// This keeps the existing notification.service.ts imports working unchanged.
export {
  otpVerificationEmail,
  welcomeEmail,
  shipmentCreatedEmail,
  paymentConfirmedEmail,
  courierAssignedEmail,
  deliveredEmail,
  deliveryFailedEmail,
  outForDeliveryEmail,
} from './resend';

// ── Test helper: reset singleton (test use only) ───────────────────────────────
export function _resetMailerSingletons(): void {
  _nodemailerTransporter = null;
  _resendClient = null;
}
