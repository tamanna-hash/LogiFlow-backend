import { z } from 'zod';

// ── Optimize query ────────────────────────────────────────────────────────────

export const optimizeRouteQuerySchema = z.object({
  fromHubId: z.string().cuid('Invalid source hub ID.'),
  toHubId:   z.string().cuid('Invalid destination hub ID.'),
}).refine((data) => data.fromHubId !== data.toHubId, {
  message: 'Source and destination must be different hubs.',
  path: ['toHubId'],
});

export type OptimizeRouteQuery = z.infer<typeof optimizeRouteQuerySchema>;

// ── Route management (ADMIN) ─────────────────────────────────────────────────

export const createRouteSchema = z.object({
  fromHubId: z.string().cuid('Invalid source hub ID.'),
  toHubId:   z.string().cuid('Invalid destination hub ID.'),
  cost:      z.number().positive('Cost must be a positive number.'),
  isActive:  z.boolean().default(true),
}).refine((data) => data.fromHubId !== data.toHubId, {
  message: 'Source and destination must be different hubs.',
  path: ['toHubId'],
});

export const updateRouteSchema = z.object({
  cost:     z.number().positive('Cost must be a positive number.').optional(),
  isActive: z.boolean().optional(),
});

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;

// ── Shipment param (reuse from risk module) ───────────────────────────────────

export const shipmentIdParamSchema = z.object({
  shipmentId: z.string().cuid('Invalid shipment ID format.'),
});

export type ShipmentIdParam = z.infer<typeof shipmentIdParamSchema>;
