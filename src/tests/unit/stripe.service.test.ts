import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import * as stripeLib from '../../app/lib/stripe';
import {
  initiateStripeCheckout,
  handleStripeWebhook,
} from '../../app/modules/payment/payment.service';
import { ServiceUnavailableError, NotFoundError, BadRequestError, ConflictError } from '../../app/errors';

vi.mock('../../app/lib/stripe');
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../app/modules/notification/notification.service', () => ({
  notifyPaymentCompleted: vi.fn(),
  notifyGeneric: vi.fn(),
}));

// ── Shared fixtures ──────────────────────────────────────────────────────────

const mockShipment = {
  id: 'shipment_01',
  customerId: 'user_01',
  price: '200.00',
  status: 'CREATED',
  paymentStatus: 'PENDING',
  trackingNumber: 'LF-20260901-TEST001',
  customer: { email: 'test@test.com', firstName: 'Test' },
};

const mockSession = {
  id: 'cs_test_session_01',
  url: 'https://checkout.stripe.com/pay/cs_test_session_01',
  amount_total: 20000, // 200.00 BDT in paisa
  metadata: { paymentId: 'payment_01', shipmentId: 'shipment_01' },
  payment_intent: 'pi_test_01',
};

const makeWebhookEvent = (type: string, data: object) => ({
  id: `evt_${Date.now()}`,
  type,
  data: { object: data },
});

// ── initiateStripeCheckout ───────────────────────────────────────────────────

describe('PaymentService — initiateStripeCheckout', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws ServiceUnavailableError when Stripe is not configured', async () => {
    vi.mocked(stripeLib.isStripeConfigured).mockReturnValue(false);

    await expect(initiateStripeCheckout('shipment_01', 'user_01'))
      .rejects.toThrow(ServiceUnavailableError);
  });

  it('throws NotFoundError when shipment does not exist', async () => {
    vi.mocked(stripeLib.isStripeConfigured).mockReturnValue(true);
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue(null);

    await expect(initiateStripeCheckout('nonexistent', 'user_01'))
      .rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when shipment is already paid', async () => {
    vi.mocked(stripeLib.isStripeConfigured).mockReturnValue(true);
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, paymentStatus: 'COMPLETED',
    } as never);

    await expect(initiateStripeCheckout('shipment_01', 'user_01'))
      .rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when shipment status is not CREATED', async () => {
    vi.mocked(stripeLib.isStripeConfigured).mockReturnValue(true);
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, status: 'IN_TRANSIT',
    } as never);

    await expect(initiateStripeCheckout('shipment_01', 'user_01'))
      .rejects.toThrow(BadRequestError);
  });

  it('throws ConflictError when a Stripe session already exists for this shipment', async () => {
    vi.mocked(stripeLib.isStripeConfigured).mockReturnValue(true);
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue(mockShipment as never);
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce({ id: 'payment_01', stripeSessionId: 'cs_existing' } as never);

    await expect(initiateStripeCheckout('shipment_01', 'user_01'))
      .rejects.toThrow(ConflictError);
  });

  it('creates a Checkout Session and returns checkoutUrl', async () => {
    vi.mocked(stripeLib.isStripeConfigured).mockReturnValue(true);
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue(mockShipment as never);
    // No existing Stripe session
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null)
      // No existing pending payment without session
      .mockResolvedValueOnce(null);
    vi.mocked(prisma.payment.create).mockResolvedValue({
      id: 'payment_01', amount: '200.00',
    } as never);
    vi.mocked(stripeLib.createCheckoutSession).mockResolvedValue(mockSession as never);
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);

    const result = await initiateStripeCheckout('shipment_01', 'user_01');

    expect(result.checkoutUrl).toBe(mockSession.url);
    expect(result.paymentId).toBe('payment_01');
    expect(result.amount).toBe('200.00');
    expect(stripeLib.createCheckoutSession).toHaveBeenCalledOnce();
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ stripeSessionId: 'cs_test_session_01' }),
      }),
    );
  });
});

// ── handleStripeWebhook ──────────────────────────────────────────────────────

describe('PaymentService — handleStripeWebhook', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when webhook signature is invalid', async () => {
    vi.mocked(stripeLib.constructWebhookEvent).mockImplementation(() => {
      throw new Error('No signatures found matching the expected signature');
    });

    await expect(
      handleStripeWebhook(Buffer.from('{}'), 'invalid_sig'),
    ).rejects.toThrow(/signature/i);
  });

  it('is idempotent — skips already-processed event IDs', async () => {
    const event = makeWebhookEvent('checkout.session.completed', mockSession);
    vi.mocked(stripeLib.constructWebhookEvent).mockReturnValue(event as never);
    // Simulate event already stored on a payment
    vi.mocked(prisma.payment.findFirst).mockResolvedValue({ id: 'payment_01' } as never);

    const result = await handleStripeWebhook(Buffer.from('{}'), 'sig');
    expect(result).toEqual({ received: true });
    // Should not attempt to update payment
    expect(prisma.payment.update).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('completes payment on checkout.session.completed with valid data', async () => {
    const event = makeWebhookEvent('checkout.session.completed', mockSession);
    vi.mocked(stripeLib.constructWebhookEvent).mockReturnValue(event as never);
    // No existing event record
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null)   // idempotency check (no existing event)
      .mockResolvedValueOnce({       // find by session ID
        id: 'payment_01',
        status: 'PENDING',
        amount: '200.00',
        shipmentId: 'shipment_01',
        shipment: {
          trackingNumber: 'LF-20260901-TEST001',
          customer: { id: 'user_01', email: 'test@test.com', firstName: 'Test' },
        },
      } as never);

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({ payment: { update: vi.fn() }, shipment: { update: vi.fn() } } as never),
    );

    const result = await handleStripeWebhook(Buffer.from('{}'), 'sig');
    expect(result).toEqual({ received: true });
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('fails payment on amount mismatch', async () => {
    const sessionWithWrongAmount = { ...mockSession, amount_total: 10000 }; // 100 != 200
    const event = makeWebhookEvent('checkout.session.completed', sessionWithWrongAmount);
    vi.mocked(stripeLib.constructWebhookEvent).mockReturnValue(event as never);
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null) // idempotency
      .mockResolvedValueOnce({
        id: 'payment_01', status: 'PENDING', amount: '200.00',
        shipmentId: 'shipment_01',
        shipment: { trackingNumber: 'LF-TEST', customer: { id: 'u1', email: 'a@b.com', firstName: 'A' } },
      } as never);
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);

    const result = await handleStripeWebhook(Buffer.from('{}'), 'sig');
    expect(result).toEqual({ received: true });
    // Payment should be marked FAILED
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('cancels payment on checkout.session.expired', async () => {
    const event = makeWebhookEvent('checkout.session.expired', { id: 'cs_expired_01' });
    vi.mocked(stripeLib.constructWebhookEvent).mockReturnValue(event as never);
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null) // idempotency check
      .mockResolvedValueOnce({ id: 'payment_expired' } as never); // find by session
    vi.mocked(prisma.payment.update).mockResolvedValue({} as never);

    const result = await handleStripeWebhook(Buffer.from('{}'), 'sig');
    expect(result).toEqual({ received: true });
    expect(prisma.payment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
    );
  });

  it('skips checkout.session.completed when payment is already COMPLETED', async () => {
    const event = makeWebhookEvent('checkout.session.completed', mockSession);
    vi.mocked(stripeLib.constructWebhookEvent).mockReturnValue(event as never);
    vi.mocked(prisma.payment.findFirst)
      .mockResolvedValueOnce(null) // idempotency — different event check
      .mockResolvedValueOnce({ id: 'payment_01', status: 'COMPLETED', amount: '200.00', shipmentId: 'shipment_01', shipment: { trackingNumber: 'T', customer: { id: 'u', email: 'e', firstName: 'F' } } } as never);

    const result = await handleStripeWebhook(Buffer.from('{}'), 'sig');
    expect(result).toEqual({ received: true });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
