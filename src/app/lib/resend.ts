import { Resend } from 'resend';
import { env } from '../config/env';

export const resend = new Resend(env.RESEND_API_KEY);

const FROM_ADDRESS = 'LogiFlow <noreply@logiflow.app>';

export interface SendEmailOptions {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

/**
 * sendEmail — fire-and-forget wrapper around Resend.
 * Email failures are non-fatal: errors are logged but never thrown.
 * The parent operation (shipment creation, etc.) always succeeds regardless.
 */
export async function sendEmail(options: SendEmailOptions): Promise<void> {
  try {
    const { error } = await resend.emails.send({
      from: FROM_ADDRESS,
      to: options.to,
      subject: options.subject,
      html: options.html,
      ...(options.text && { text: options.text }),
    });

    if (error) {
      console.warn('[Resend] Email send failed:', error);
    }
  } catch (err) {
    console.warn('[Resend] Email send error:', err);
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
