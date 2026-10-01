/**
 * payment.contract.test.ts
 *
 * Tests that the payment service returns the shape and fields the frontend
 * expects — including the bKash callback contract fix (shipmentId in return).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import * as bkashLib from '../../app/lib/bkash';
import {
  handleBkashCallback,
  getPaymentByShipment,
} from '../../app/modules/payment/payment.service';
import { AuthorizationError, NotFoundError } from '../../app/errors';

vi.mock('../../app/lib/bkash');
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../app/modules/notification/notification.service', () => ({
  notifyPaymentCompleted: vi.fn(),
}));

const mockPayment = {
  id: 'payment_01',
  status: 'PENDING',
  amount: '150.00',
  shipmentId: 'shipment_01',
  shipment: {
    trackingNumber: 'LF-20260905-A3F7B2C1',
    customer: { id: 'user_01', email: 'test@test.com', firstName: 'Test' },
  },
};

const mockExecuteSuccess = {
  paymentID: 'bkash_pay_01',
  trxID: 'TRX123456',
  transactionStatus: 'Completed',
  amount: '150.00',
  currency: 'BDT',
  intent: 'sale',
  merchantInvoiceNumber: 'payment_01',
  payerReference: 'payment_01',
  customerMsisdn: '01700000000',
  paymentExecuteTime: new Date().toISOString(),
  statusCode: '0000',
  statusMessage: 'Successful',
};

describe('PaymentService — bKash callback returns shipmentId (contract fix)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns shipmentId on success', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(mockPayment as never);
    vi.mocked(bkashLib.executeBkashPayment).mockResolvedValue(mockExecuteSuccess);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({ payment: { update: vi.fn() }, shipment: { update: vi.fn() } } as never),
    );

    const result = await handleBkashCallback('bkash_pay_01');

    expect(result.success).toBe(true);
    // Frontend payment page needs shipmentId to poll payment status
    expect(result.shipmentId).toBe('shipment_01');
  });

  it('returns shipmentId on idempotent COMPLETED call', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...mockPayment, status: 'COMPLETED',
    } as never);

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(true);
    expect(result.shipmentId).toBe('shipment_01');
  });

  it('returns shipmentId on failure paths', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(mockPayment as never);
    vi.mocked(bkashLib.executeBkashPayment).mockResolvedValue({
      ...mockExecuteSuccess, transactionStatus: 'Failed',
    });
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(false);
    expect(result.shipmentId).toBe('shipment_01');
  });

  it('returns null shipmentId when payment not found', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);

    const result = await handleBkashCallback('unknown_id');
    expect(result.success).toBe(false);
    expect(result.shipmentId).toBeNull();
  });
});

describe('PaymentService — getPaymentByShipment response shape', () => {
  beforeEach(() => vi.clearAllMocks());

  const mockPaymentRow = {
    id: 'payment_01',
    amount: '150.00',
    status: 'COMPLETED',
    provider: 'BKASH',
    paidAt: new Date(),
    failedAt: null,
    bkashTransactionId: 'TRX123456',
    stripePaymentIntent: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    shipment: { customerId: 'user_01', trackingNumber: 'LF-20260905-A3F7B2C1' },
  };

  it('returns payment with provider field for customer', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(mockPaymentRow as never);

    const result = await getPaymentByShipment('shipment_01', 'user_01', false);

    // Frontend expects these fields
    expect(result).toMatchObject({
      id: 'payment_01',
      status: 'COMPLETED',
      provider: 'BKASH',
      amount: '150.00',
    });
    // Admin-only fields should not be present for customer
    expect((result as Record<string, unknown>).bkashPaymentId).toBeUndefined();
    expect((result as Record<string, unknown>).stripeSessionId).toBeUndefined();
  });

  it('throws NotFoundError when payment does not exist', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);

    await expect(getPaymentByShipment('shipment_01', 'user_01', false))
      .rejects.toThrow(NotFoundError);
  });

  it('throws AuthorizationError when customer requests another customers payment', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...mockPaymentRow,
      shipment: { customerId: 'different_user', trackingNumber: 'LF-TEST' },
    } as never);

    await expect(getPaymentByShipment('shipment_01', 'user_01', false))
      .rejects.toThrow(AuthorizationError);
  });

  it('allows admin to access any payment', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...mockPaymentRow,
      shipment: { customerId: 'different_user', trackingNumber: 'LF-TEST' },
    } as never);

    const result = await getPaymentByShipment('shipment_01', 'admin_01', true);
    expect(result).toBeDefined();
  });
});
