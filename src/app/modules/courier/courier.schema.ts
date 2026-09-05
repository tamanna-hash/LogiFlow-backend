import { z } from 'zod';
import { CourierAvailability, DeliveryFailureReason } from '@prisma/client';

export const updateAvailabilitySchema = z.object({
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE'] as const),
});

export const rejectAssignmentSchema = z.object({
  reason: z.string().max(300).optional(),
});

export const deliveryFailedSchema = z.object({
  failureReason: z.nativeEnum(DeliveryFailureReason),
  notes: z.string().max(300).optional(),
});

export const deliveryConfirmSchema = z.object({
  notes: z.string().max(300).optional(),
});

export const earningsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  fromDate: z.string().datetime().optional(),
  toDate: z.string().datetime().optional(),
});
