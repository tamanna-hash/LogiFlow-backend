import { Resend } from 'resend';
import { env } from '../config/env';

export const resend = new Resend(env.RESEND_API_KEY);

// In development: use Resend's sandbox domain (no domain verification needed)
// In production: change to your verified domain e.g. 'LogiFlow <noreply@yourdomain.com>'
const FROM_ADDRESS =
  env.NODE_ENV === 'production'
    ? 'LogiFlow <noreply@logiflow.app>'
    : 'LogiFlow <onboarding@resend.dev>';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * sendEmail — sends email via Resend.
 * Non-critical emails (notifications, welcome) swallow errors.
 * Use sendEmailCritical for OTP/auth emails where failure should be visible.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  try {
    const { data, error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(options.text && { text: options.text }),
    });

    if (error) {
      console.warn('[Resend] Email send failed:', JSON.stringify(error));
    } else {
      console.log('[Resend] Email sent, id:', data?.id);
    }
  } catch (err) {
    console.warn('[Resend] Email send error:', err);
  }
}
}

// ── Email templates ───────────────────────────────────────────────────────────

export function shipmentCreatedEmail(data: {
  name: string;
  trackingNumber: string;
  price: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Shipment Booked — LogiFlow</h2>
      <p>Hi ${data.name},</p>
      <p>Your shipment has been successfully booked.</p>
      <p><strong>Tracking Number:</strong> ${data.trackingNumber}</p>
      <p><strong>Amount Due:</strong> BDT ${data.price}</p>
      <p>Please complete your payment to proceed with pickup.</p>
      <p>Thank you for using LogiFlow.</p>
    </div>
  `;
}

export function paymentConfirmedEmail(data: {
  name: string;
  trackingNumber: string;
  transactionId: string;
  amount: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Payment Confirmed — LogiFlow</h2>
      <p>Hi ${data.name},</p>
      <p>Your payment has been confirmed.</p>
      <p><strong>Tracking Number:</strong> ${data.trackingNumber}</p>
      <p><strong>Transaction ID:</strong> ${data.transactionId}</p>
      <p><strong>Amount Paid:</strong> BDT ${data.amount}</p>
      <p>Your shipment is now awaiting pickup scheduling.</p>
    </div>
  `;
}

export function courierAssignedEmail(data: {
  name: string;
  trackingNumber: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Courier Assigned — LogiFlow</h2>
      <p>Hi ${data.name},</p>
      <p>A courier has been assigned to your shipment <strong>${data.trackingNumber}</strong>.</p>
      <p>Your parcel will be picked up shortly.</p>
    </div>
  `;
}

export function deliveredEmail(data: {
  name: string;
  trackingNumber: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Parcel Delivered — LogiFlow</h2>
      <p>Hi ${data.name},</p>
      <p>Your shipment <strong>${data.trackingNumber}</strong> has been successfully delivered.</p>
      <p>Thank you for choosing LogiFlow!</p>
    </div>
  `;
}

export function deliveryFailedEmail(data: {
  name: string;
  trackingNumber: string;
  reason: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Delivery Attempt Failed — LogiFlow</h2>
      <p>Hi ${data.name},</p>
      <p>A delivery attempt for shipment <strong>${data.trackingNumber}</strong> was unsuccessful.</p>
      <p><strong>Reason:</strong> ${data.reason}</p>
      <p>Our team will attempt redelivery. You will be notified with updates.</p>
    </div>
  `;
}

export function outForDeliveryEmail(data: {
  name: string;
  trackingNumber: string;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Out for Delivery — LogiFlow</h2>
      <p>Hi ${data.name},</p>
      <p>Your shipment <strong>${data.trackingNumber}</strong> is out for delivery today.</p>
      <p>Please ensure someone is available to receive it.</p>
    </div>
  `;
}

export function otpVerificationEmail(data: {
  name: string;
  email: string;
  otp: string;
  expirationMinutes: number;
}): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px; border: 1px solid #e5e7eb; border-radius: 8px;">
      <h2 style="color: #1f2937; margin-bottom: 8px;">Verify your email — LogiFlow</h2>
      <p style="color: #6b7280;">Hi ${data.name},</p>
      <p style="color: #374151;">Use the code below to verify your email address <strong>${data.email}</strong>.</p>
      <div style="margin: 24px 0; text-align: center;">
        <span style="display: inline-block; font-size: 36px; font-weight: 700; letter-spacing: 12px; color: #111827; background: #f3f4f6; padding: 16px 24px; border-radius: 8px;">
          ${data.otp}
        </span>
      </div>
      <p style="color: #6b7280; font-size: 14px;">
        This code expires in <strong>${data.expirationMinutes} minutes</strong>.
        If you did not create a LogiFlow account, you can safely ignore this email.
      </p>
      <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;" />
      <p style="color: #9ca3af; font-size: 12px;">LogiFlow — Courier &amp; Logistics Management Platform</p>
    </div>
  `;
}

export function welcomeEmail(data: { name: string; email: string }): string {
  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #1f2937;">Welcome to LogiFlow, ${data.name}!</h2>
      <p style="color: #374151;">Your account for <strong>${data.email}</strong> is now active.</p>
      <p style="color: #374151;">You can now book shipments, track parcels, and manage your logistics — all in one place.</p>
      <p style="color: #6b7280; font-size: 14px;">Thank you for choosing LogiFlow.</p>
    </div>
  `;
}
