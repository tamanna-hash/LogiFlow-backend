import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import {
  getShipmentById,
  cancelShipment,
} from '../../app/modules/shipment/shipment.service';
import { AuthorizationError, BadRequestError } from '../../app/errors';

vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../app/modules/notification/notification.service', () => ({
  notifyGeneric: vi.fn(),
}));

const mockShipment = {
  id: 'ship_01',
  trackingNumber: 'LF-20260905-ABC12345',
  status: 'CREATED',
  paymentStatus: 'PENDING',
  senderName: 'Sender',
  recipientName: 'Recipient',
  recipientCity: 'Dhaka',
  deliveryType: 'STANDARD',
  parcelType: 'REGULAR',
  price: '150.00',
  createdAt: new Date(),
  updatedAt: new Date(),
  customerId: 'customer_01',
  senderPhone: '01700000000',
  senderAddress: 'Address 1',
  senderCity: 'Dhaka',
  recipientPhone: '01800000000',
  recipientAddress: 'Address 2',
  declaredWeightKg: 1.5,
  actualWeightKg: null,
  description: null,
  specialInstructions: null,
  deliveryAttemptCount: 0,
  deliveredAt: null,
  cancelledAt: null,
  cancellationReason: null,
  returnReason: null,
  originZoneId: 'zone_01',
  destinationZoneId: 'zone_02',
  currentHubId: null,
  originZone: null,
  destinationZone: null,
  currentHub: null,
  items: [],
};

describe('Authorization — Shipment ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CUSTOMER can access their own shipment', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue(mockShipment as never);

    await expect(
      getShipmentById('ship_01', 'CUSTOMER', 'customer_01'),
    ).resolves.not.toThrow();
  });

  it('CUSTOMER cannot access another customer shipment — throws 403 not 404', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, customerId: 'different_customer',
    } as never);

    await expect(
      getShipmentById('ship_01', 'CUSTOMER', 'customer_01'),
    ).rejects.toThrow(AuthorizationError);
  });

  it('ADMIN can access any shipment', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, customerId: 'some_other_customer',
    } as never);

    await expect(
      getShipmentById('ship_01', 'ADMIN', 'admin_01'),
    ).resolves.not.toThrow();
  });

  it('OPERATIONS_MANAGER can access any shipment', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, customerId: 'any_customer',
    } as never);

    await expect(
      getShipmentById('ship_01', 'OPERATIONS_MANAGER', 'ops_01'),
    ).resolves.not.toThrow();
  });
});

describe('Authorization — Shipment cancellation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('CUSTOMER can cancel own shipment in CREATED status', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, status: 'CREATED', customerId: 'customer_01', assignments: [],
    } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue({} as never);

    await expect(
      cancelShipment('ship_01', 'Changed mind', 'CUSTOMER', 'customer_01'),
    ).resolves.not.toThrow();
  });

  it('CUSTOMER cannot cancel shipment in ASSIGNED status', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, status: 'ASSIGNED', customerId: 'customer_01', assignments: [],
    } as never);

    await expect(
      cancelShipment('ship_01', 'reason', 'CUSTOMER', 'customer_01'),
    ).rejects.toThrow(BadRequestError);
  });

  it('CUSTOMER cannot cancel another customer shipment', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, status: 'CREATED', customerId: 'different_customer', assignments: [],
    } as never);

    await expect(
      cancelShipment('ship_01', 'reason', 'CUSTOMER', 'customer_01'),
    ).rejects.toThrow(AuthorizationError);
  });

  it('CUSTOMER cannot cancel DELIVERED shipment', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, status: 'DELIVERED', customerId: 'customer_01', assignments: [],
    } as never);

    await expect(
      cancelShipment('ship_01', 'reason', 'CUSTOMER', 'customer_01'),
    ).rejects.toThrow(BadRequestError);
  });

  it('OPS_MANAGER can cancel shipment in any non-terminal state', async () => {
    vi.mocked(prisma.shipment.findUnique).mockResolvedValue({
      ...mockShipment, status: 'ASSIGNED', customerId: 'customer_01', assignments: [],
    } as never);
    vi.mocked(prisma.$transaction).mockResolvedValue({} as never);

    await expect(
      cancelShipment('ship_01', 'Operational reason', 'OPERATIONS_MANAGER', 'ops_01'),
    ).resolves.not.toThrow();
  });
});
