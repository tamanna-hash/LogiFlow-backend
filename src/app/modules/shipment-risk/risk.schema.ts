import { z } from 'zod';
import type { RiskLevel, ShipmentStatus } from '../../../generated/prisma';

export const shipmentIdParamSchema = z.object({
  shipmentId: z.string().cuid('Invalid shipment ID format.'),
});

export const riskHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

// Enum values mirrored from generated Prisma client so we can use
// z.enum() without importing the full generated namespace at schema parse time.
const RISK_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const satisfies readonly RiskLevel[];

const SHIPMENT_STATUSES = [
  'CREATED', 'PICKUP_REQUESTED', 'ASSIGNED', 'PICKED_UP',
  'AT_ORIGIN_HUB', 'IN_TRANSIT', 'AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY',
  'DELIVERED', 'DELIVERY_FAILED', 'CANCELLED', 'RETURN_INITIATED',
  'RETURNING', 'RETURNED',
] as const satisfies readonly ShipmentStatus[];

export const riskListQuerySchema = z.object({
  page:           z.coerce.number().int().positive().default(1),
  limit:          z.coerce.number().int().positive().max(100).default(20),
  riskLevel:      z.enum(RISK_LEVELS).optional(),
  shipmentStatus: z.enum(SHIPMENT_STATUSES).optional(),
  search:         z.string().max(100).optional(),
  fromDate:       z.string().optional(),
  toDate:         z.string().optional(),
});

// Allowed caller roles for the list / overview endpoints.
// Declared here so the service can import it without depending on the middleware type.
export type RiskListRole = 'OPERATIONS_MANAGER' | 'ADMIN' | 'HUB_MANAGER';

export type ShipmentIdParam = z.infer<typeof shipmentIdParamSchema>;
export type RiskHistoryQuery = z.infer<typeof riskHistoryQuerySchema>;
export type RiskListQuery    = z.infer<typeof riskListQuerySchema>;
