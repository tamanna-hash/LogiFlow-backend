import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import * as bkashLib from '../../app/lib/bkash';
import { handleBkashCallback } from '../../app/modules/payment/payment.service';

vi.mock('../../app/lib/bkash');
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../app/modules/notification/notification.service', () => ({
  notifyPaymentCompleted: vi.fn(),
  notifyGeneric: vi.fn(),
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

describe('PaymentService — handleBkashCallback', () => {
  beforeEach(() => vi.clearAllMocks());

  it('completes payment on successful bKash execution', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(mockPayment as never);
    vi.mocked(bkashLib.executeBkashPayment).mockResolvedValue(mockExecuteSuccess);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        payment: { update: vi.fn() },
        shipment: { update: vi.fn() },
      } as never),
    );

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(true);
  });

  it('is idempotent — returns success for already COMPLETED payment', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...mockPayment, status: 'COMPLETED',
    } as never);

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(true);
    expect(bkashLib.executeBkashPayment).not.toHaveBeenCalled();
  });

  it('is idempotent — returns failure for already FAILED payment', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({
      ...mockPayment, status: 'FAILED',
    } as never);

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(false);
    expect(bkashLib.executeBkashPayment).not.toHaveBeenCalled();
  });

  it('fails payment when bKash transactionStatus is not Completed', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(mockPayment as never);
    vi.mocked(bkashLib.executeBkashPayment).mockResolvedValue({
      ...mockExecuteSuccess, transactionStatus: 'Failed',
    });
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(false);
  });

  it('rejects payment when amount does not match', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(mockPayment as never);
    vi.mocked(bkashLib.executeBkashPayment).mockResolvedValue({
      ...mockExecuteSuccess,
      amount: '100.00', // different from 150.00
    });
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(false);
    expect(result.message).toContain('mismatch');
  });

  it('rejects payment when merchantInvoiceNumber does not match', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(mockPayment as never);
    vi.mocked(bkashLib.executeBkashPayment).mockResolvedValue({
      ...mockExecuteSuccess,
      merchantInvoiceNumber: 'different_payment_id',
    });
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);

    const result = await handleBkashCallback('bkash_pay_01');
    expect(result.success).toBe(false);
  });

  it('returns failure for unknown paymentID', async () => {
    vi.mocked(prisma.payment.findFirst).mockResolvedValue(null);

    const result = await handleBkashCallback('unknown_id');
    expect(result.success).toBe(false);
    expect(bkashLib.executeBkashPayment).not.toHaveBeenCalled();
  });
});
