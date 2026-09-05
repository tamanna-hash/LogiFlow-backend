import { z } from 'zod';

export const createHubSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20).toUpperCase(),
  address: z.string().min(5).max(200),
  city: z.string().min(2).max(100),
  phone: z.string().optional(),
});

export const updateHubSchema = createHubSchema.partial();

export const hubQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().optional(),
});

export const createZoneSchema = z.object({
  name: z.string().min(2).max(100),
  code: z.string().min(2).max(20).toUpperCase(),
  hubId: z.string().cuid('Invalid hub ID'),
  description: z.string().max(300).optional(),
});

export const updateZoneSchema = createZoneSchema.omit({ hubId: true }).partial();

export const hubTransferSchema = z.object({
  shipmentId: z.string().cuid('Invalid shipment ID'),
  toHubId: z.string().cuid('Invalid hub ID'),
  estimatedArrival: z.string().datetime().optional(),
  notes: z.string().max(300).optional(),
});

export type CreateHubInput = z.infer<typeof createHubSchema>;
export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type HubTransferInput = z.infer<typeof hubTransferSchema>;
