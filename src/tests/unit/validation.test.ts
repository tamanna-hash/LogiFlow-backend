import { describe, it, expect } from 'vitest';
import { registerSchema, loginSchema } from '../../app/modules/auth/auth.schema';
import { createShipmentSchema } from '../../app/modules/shipment/shipment.schema';
import { calculatePriceSchema } from '../../app/modules/pricing/pricing.schema';

describe('Zod Validation — Auth schemas', () => {
  it('accepts valid registration input', () => {
    const result = registerSchema.safeParse({
      firstName: 'John',
      lastName: 'Doe',
      email: 'john@example.com',
      password: 'SecurePass1',
    });
    expect(result.success).toBe(true);
  });

  it('rejects short password', () => {
    const result = registerSchema.safeParse({
      firstName: 'John', lastName: 'Doe',
      email: 'john@example.com', password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid email', () => {
    const result = registerSchema.safeParse({
      firstName: 'John', lastName: 'Doe',
      email: 'not-an-email', password: 'password123',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing required fields', () => {
    const result = registerSchema.safeParse({ email: 'john@example.com' });
    expect(result.success).toBe(false);
  });

  it('lowercases email on parse', () => {
    const result = registerSchema.safeParse({
      firstName: 'John', lastName: 'Doe',
      email: 'JOHN@EXAMPLE.COM', password: 'password123',
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe('john@example.com');
  });

  it('rejects invalid Bangladesh phone number', () => {
    const result = registerSchema.safeParse({
      firstName: 'John', lastName: 'Doe',
      email: 'john@example.com', password: 'password123',
      phone: '12345678',
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid BD phone number', () => {
    const result = registerSchema.safeParse({
      firstName: 'John', lastName: 'Doe',
      email: 'john@example.com', password: 'password123',
      phone: '01712345678',
    });
    expect(result.success).toBe(true);
  });
});

describe('Zod Validation — Shipment schema', () => {
  const validShipment = {
    senderName: 'Sender Name',
    senderPhone: '01712345678',
    senderAddress: '123 Sender Street',
    senderCity: 'Dhaka',
    originZoneId: 'clxxxxxxxxxxxxxxxxxxxxxx01',
    recipientName: 'Recipient Name',
    recipientPhone: '01812345678',
    recipientAddress: '456 Recipient Road',
    recipientCity: 'Chittagong',
    destinationZoneId: 'clxxxxxxxxxxxxxxxxxxxxxx02',
    deliveryType: 'STANDARD',
    parcelType: 'REGULAR',
    declaredWeightKg: 1.5,
    items: [{ description: 'Documents', weightKg: 1.5, quantity: 1, parcelType: 'REGULAR' }],
  };

  it('accepts valid shipment input', () => {
    const result = createShipmentSchema.safeParse(validShipment);
    expect(result.success).toBe(true);
  });

  it('rejects zero weight', () => {
    const result = createShipmentSchema.safeParse({ ...validShipment, declaredWeightKg: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects empty items array', () => {
    const result = createShipmentSchema.safeParse({ ...validShipment, items: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid deliveryType enum', () => {
    const result = createShipmentSchema.safeParse({ ...validShipment, deliveryType: 'TELEPORT' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid parcelType enum', () => {
    const result = createShipmentSchema.safeParse({ ...validShipment, parcelType: 'LIQUID' });
    expect(result.success).toBe(false);
  });
});

describe('Zod Validation — Pricing calculate', () => {
  it('accepts valid calculate input', () => {
    const result = calculatePriceSchema.safeParse({
      originZoneId: 'clxxxxxxxxxxxxxxxxxxxxxx01',
      destinationZoneId: 'clxxxxxxxxxxxxxxxxxxxxxx02',
      deliveryType: 'STANDARD',
      parcelType: 'REGULAR',
      weightKg: 2.5,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative weight', () => {
    const result = calculatePriceSchema.safeParse({
      originZoneId: 'clxxxxxxxxxxxxxxxxxxxxxx01',
      destinationZoneId: 'clxxxxxxxxxxxxxxxxxxxxxx02',
      weightKg: -1,
    });
    expect(result.success).toBe(false);
  });
});
