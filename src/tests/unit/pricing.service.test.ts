import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import { calculatePrice } from '../../app/modules/pricing/pricing.service';
import { BadRequestError } from '../../app/errors';

vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));

const mockRule = {
  id: 'rule_01',
  name: 'Standard Rule',
  originZoneId: 'zone_01',
  destinationZoneId: 'zone_02',
  deliveryType: 'STANDARD',
  parcelType: 'REGULAR',
  basePrice: '50.00',
  pricePerKg: '10.00',
  baseWeightKg: 1.0,
  zoneSurcharge: '20.00',
  deliveryTypeSurcharge: '0.00',
  isDefault: false,
  isActive: true,
  createdAt: new Date(),
};

describe('PricingService — calculatePrice', () => {
  beforeEach(() => vi.clearAllMocks());

  it('calculates correct price for 1kg parcel (within base weight)', async () => {
    vi.mocked(prisma.pricingRule.findFirst).mockResolvedValue(mockRule as never);

    const result = await calculatePrice({
      originZoneId: 'zone_01',
      destinationZoneId: 'zone_02',
      deliveryType: 'STANDARD',
      parcelType: 'REGULAR',
      weightKg: 1.0,
    });

    // base(50) + weightCharge(0, within 1kg base) + zone(20) + typeCharge(0) = 70
    expect(result.total).toBe(70);
    expect(result.basePrice).toBe(50);
    expect(result.weightCharge).toBe(0);
    expect(result.zoneSurcharge).toBe(20);
  });

  it('calculates correct price for 3kg parcel (2kg over base)', async () => {
    vi.mocked(prisma.pricingRule.findFirst).mockResolvedValue(mockRule as never);

    const result = await calculatePrice({
      originZoneId: 'zone_01',
      destinationZoneId: 'zone_02',
      deliveryType: 'STANDARD',
      parcelType: 'REGULAR',
      weightKg: 3.0,
    });

    // base(50) + weightCharge(2kg * 10 = 20) + zone(20) + typeCharge(0) = 90
    expect(result.total).toBe(90);
    expect(result.weightCharge).toBe(20);
  });

  it('throws BadRequestError when no pricing rule found', async () => {
    vi.mocked(prisma.pricingRule.findFirst).mockResolvedValue(null);

    await expect(calculatePrice({
      originZoneId: 'zone_unknown',
      destinationZoneId: 'zone_unknown',
      deliveryType: 'STANDARD',
      parcelType: 'REGULAR',
      weightKg: 1,
    })).rejects.toThrow(BadRequestError);
  });

  it('returns cached result on second call with same params', async () => {
    const { cacheGet } = await import('../../app/lib/redis');
    vi.mocked(cacheGet).mockResolvedValueOnce({
      basePrice: 50, weightCharge: 0, zoneSurcharge: 20,
      deliveryTypeSurcharge: 0, total: 70,
    });

    const result = await calculatePrice({
      originZoneId: 'zone_01', destinationZoneId: 'zone_02',
      deliveryType: 'STANDARD', parcelType: 'REGULAR', weightKg: 1,
    });

    expect(result.total).toBe(70);
    expect(prisma.pricingRule.findFirst).not.toHaveBeenCalled();
  });
});
