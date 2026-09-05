import { z } from 'zod';
import { Role } from '@prisma/client';

export const updateProfileSchema = z.object({
  firstName: z.string().min(2).max(50).optional(),
  lastName: z.string().min(2).max(50).optional(),
  phone: z
    .string()
    .regex(/^(\+?88)?01[3-9]\d{8}$/, 'Invalid Bangladesh phone number')
    .optional(),
  // Customer profile fields
  defaultAddress: z.string().max(200).optional(),
  city: z.string().max(100).optional(),
  postalCode: z.string().max(20).optional(),
  // Courier profile fields
  vehicleType: z.string().max(50).optional(),
  vehicleNumber: z.string().max(30).optional(),
  licenseNumber: z.string().max(30).optional(),
});

export const updateRoleSchema = z.object({
  role: z.nativeEnum(Role),
});

export const userListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
  role: z.nativeEnum(Role).optional(),
  isActive: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  search: z.string().optional(),
  sortBy: z.enum(['createdAt', 'email', 'firstName']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  includeDeleted: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UpdateRoleInput = z.infer<typeof updateRoleSchema>;
