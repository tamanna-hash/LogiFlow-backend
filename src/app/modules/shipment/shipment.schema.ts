import { z } from 'zod';
import { DeliveryType, ParcelType, ShipmentStatus } from '@prisma/client';

const shipmentItemSchema = z.object({
  description: z.string().min(1).max(200),
  weightKg: z.coerce.number().positive('Item weight must be positive'),
  quantity: z.coerce.number().int().positive().default(1),
  parcelType: z.nativeEnum(ParcelType).default('REGULAR'),
});

export const createShipmentSchema = z.object({
  senderName: z.string().min(2).max(100),
  senderPhone: z.string().regex(/^(\+?88)?01[3-9]\d{8}$/, 'Invalid sender phone'),
  senderAddress: z.string().min(5).max(200),
  senderCity: z.string().min(2).max(100),
  originZoneId: z.string().cuid('Invalid origin zone ID'),
  recipientName: z.string().min(2).max(100),
  recipientPhone: z.string().regex(/^(\+?88)?01[3-9]\d{8}$/, 'Invalid recipient phone'),
  recipientAddress: z.string().min(5).max(200),
  recipientCity: z.string().min(2).max(100),
  destinationZoneId: z.string().cuid('Invalid destination zone ID'),
  deliveryType: z.nativeEnum(DeliveryType).default('STANDARD'),
  parcelType: z.nativeEnum(ParcelType).default('REGULAR'),
  declaredWeightKg: z.coerce.number().positive('Declared weight must be positive'),
  description: z.string().max(300).optional(),
  specialInstructions: z.string().max(300).optional(),
  items: z.array(shipmentItemSchema).min(1, 'At least one item is required'),
});

export const updateShipmentSchema = z.object({
  recipientName: z.string().min(2).max(100).optional(),
  recipientPhone: z.string().regex(/^(\+?88)?01[3-9]\d{8}$/).optional(),
  recipientAddress: z.string().min(5).max(200).optional(),
  recipientCity: z.string().min(2).max(100).optional(),
  specialInstructions: z.string().max(300).optional(),
});

export const cancelShipmentSchema = z.object({
  reason: z.string().min(5, 'Cancellation reason is required').max(300),
});

export const pickupRequestSchema = z.object({
  scheduledAt: z.string().datetime().optional(),
  notes: z.string().max(300).optional(),
});

export const returnShipmentSchema = z.object({
  reason: z.string().min(5).max(300),
});

export const shipmentListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  status: z.nativeEnum(ShipmentStatus).optional(),
  paymentStatus: z.string().optional(),
  deliveryType: z.nativeEnum(DeliveryType).optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'updatedAt', 'status']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
