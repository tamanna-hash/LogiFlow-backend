import { z } from 'zod';
import { paginationSchema } from './pagination';
import type { HubTransferStatus, AssignmentStatus, AssignmentType } from '../../generated/prisma';

// ── Hub Zones query ────────────────────────────────────────────────────────────
export const zoneQuerySchema = paginationSchema.extend({
  hubId: z.string().optional(),
  isActive: z
    .string()
    .transform((v) => v === 'true')
    .optional(),
});

export type ZoneQueryParams = z.infer<typeof zoneQuerySchema>;

// ── Hub Transfers query ────────────────────────────────────────────────────────
const hubTransferStatusValues: [HubTransferStatus, ...HubTransferStatus[]] = [
  'IN_TRANSIT',
  'ARRIVED',
  'CANCELLED',
];

export const transferQuerySchema = paginationSchema.extend({
  status: z.enum(hubTransferStatusValues).optional(),
});

export type TransferQueryParams = z.infer<typeof transferQuerySchema>;

// ── Assignments query ──────────────────────────────────────────────────────────
const assignmentStatusValues: [AssignmentStatus, ...AssignmentStatus[]] = [
  'ACTIVE',
  'COMPLETED',
  'CANCELLED',
  'REJECTED',
];

const assignmentTypeValues: [AssignmentType, ...AssignmentType[]] = [
  'PICKUP',
  'DELIVERY',
  'RETURN',
];

export const assignmentQuerySchema = paginationSchema.extend({
  status: z.enum(assignmentStatusValues).optional(),
  type: z.enum(assignmentTypeValues).optional(),
});

export type AssignmentQueryParams = z.infer<typeof assignmentQuerySchema>;
