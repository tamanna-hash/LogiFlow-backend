import { z } from 'zod';
import { DeliveryType, ParcelType } from '@prisma/client';

export const createPricingRuleSchema = z.object({
  name: z.string().min(2).max(100),
  originZoneId: z.string().cuid().optional().nullable(),
  destinationZoneId: z.string().cuid().optional().nullable(),
  deliveryType: z.nativeEnum(DeliveryType).optional().nullable(),
  parcelType: z.nativeEnum(ParcelType).optional().nullable(),
  basePrice: z.coerce.number().positive('Base price must be positive'),
  pricePerKg: z.coerce.number().nonnegative(),
  baseWeightKg: z.coerce.number().positive().default(1.0),
  zoneSurcharge: z.coerce.number().nonnegative().default(0),
  deliveryTypeSurcharge: z.coerce.number().nonnegative().default(0),
  isDefault: z.boolean().default(false),
});

export const updatePricingRuleSchema = createPricingRuleSchema.partial();

export const calculatePriceSchema = z.object({
  originZoneId: z.string().cuid('Invalid origin zone ID'),
  destinationZoneId: z.string().cuid('Invalid destination zone ID'),
  deliveryType: z.nativeEnum(DeliveryType).default('STANDARD'),
  parcelType: z.nativeEnum(ParcelType).default('REGULAR'),
  weightKg: z.coerce.number().positive('Weight must be positive'),
});

export type CreatePricingRuleInput = z.infer<typeof createPricingRuleSchema>;
export type CalculatePriceInput = z.infer<typeof calculatePriceSchema>;
