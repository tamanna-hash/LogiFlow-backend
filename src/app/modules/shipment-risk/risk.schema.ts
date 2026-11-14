import { z } from 'zod';

export const shipmentIdParamSchema = z.object({
  shipmentId: z.string().cuid('Invalid shipment ID format.'),
});

export const riskHistoryQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(50).default(10),
});

export type ShipmentIdParam = z.infer<typeof shipmentIdParamSchema>;
export type RiskHistoryQuery = z.infer<typeof riskHistoryQuerySchema>;
