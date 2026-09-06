import { z } from 'zod';
import { AssignmentType, ShipmentStatus } from '@prisma/client';

export const createAssignmentSchema = z.object({
  shipmentId: z.string().cuid('Invalid shipment ID'),
  courierProfileId: z.string().cuid('Invalid courier profile ID'),
  type: z.nativeEnum(AssignmentType).default('PICKUP'),
});

export const cancelAssignmentSchema = z.object({
  reason: z.string().min(5).max(300),
});

export const updateShipmentStatusSchema = z.object({
  status: z.nativeEnum(ShipmentStatus),
  reason: z.string().max(300).optional(),
});

// ON_DELIVERY is system-managed — only AVAILABLE and UNAVAILABLE can be set manually
export const updateCourierAvailabilitySchema = z.object({
  availability: z.enum(['AVAILABLE', 'UNAVAILABLE'] as const),
});
