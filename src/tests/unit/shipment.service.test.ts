import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import {
  requestPickup, cancelShipment, initiateReturn,
} from '../../app/modules/shipment/shipment.service';
import { BadRequestError, AuthorizationError } from '../../app/errors';

vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../app/modules/notification/notification.service', () => ({
  notifyGeneric: vi.fn(),
  notifyShipmentCreated: vi.fn(),
}));
vi.mock('../../app/utils/trackingNumber', () => ({
  generateTrackingNumber: vi.fn().mockResolvedValue('LF-20260905-TESTNUM1'),
}));

const baseShipment = {
  id: 'ship_01',
  trackingNumber: 'LF-20260905-TESTNUM1',
  customerId: 'customer_01',
  status: 'CREATED',
  paymentStatus: 'COMPLETED',
  assignments: [],
};

describe('ShipmentService — requestPickup', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates pickup request for paid shipment in CREATED status', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue(baseShipment as never);
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        pickupRequest: { create: vi.fn().mockResolvedValue({ id: 'pickup_01', shipmentId: 'ship_01', status: 'PENDING', scheduledAt: null, notes: null, requestedAt: new Date() }) },
        shipment: { update: vi.fn() },
        shipmentTrackingEvent: { create: vi.fn() },
      } as never),
    );

    await expect(
      requestPickup('ship_01', {}, 'CUSTOMER', 'customer_01'),
    ).resolves.not.toThrow();
  });

  it('rejects pickup request when payment not completed', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...baseShipment, paymentStatus: 'PENDING',
    } as never);

    await expect(
      requestPickup('ship_01', {}, 'CUSTOMER', 'customer_01'),
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects pickup request when status is not CREATED', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...baseShipment, status: 'PICKUP_REQUESTED', paymentStatus: 'COMPLETED',
    } as never);

    await expect(
      requestPickup('ship_01', {}, 'CUSTOMER', 'customer_01'),
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects pickup for another customer shipment', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...baseShipment, customerId: 'other_customer',
    } as never);

    await expect(
      requestPickup('ship_01', {}, 'CUSTOMER', 'customer_01'),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe('ShipmentService — initiateReturn', () => {
  beforeEach(() => vi.clearAllMocks());

  it('initiates return for DELIVERY_FAILED shipment', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      id: 'ship_01', status: 'DELIVERY_FAILED',
      deliveryAttemptCount: 3, trackingNumber: 'LF-20260905-TESTNUM1',
    } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue({} as never);

    await expect(
      initiateReturn('ship_01', 'Max attempts exceeded', 'ops_01'),
    ).resolves.not.toThrow();
  });

  it('rejects return for non DELIVERY_FAILED status', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      id: 'ship_01', status: 'IN_TRANSIT',
      deliveryAttemptCount: 0, trackingNumber: 'LF-20260905-TESTNUM1',
    } as never);

    await expect(
      initiateReturn('ship_01', 'reason', 'ops_01'),
    ).rejects.toThrow(BadRequestError);
  });
});
