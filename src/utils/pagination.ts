import { z } from 'zod';
import type { PaginationMeta } from './response';

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export const sortOrderSchema = z.enum(['asc', 'desc']).default('desc');

export type PaginationParams = z.infer<typeof paginationSchema>;

export function getPaginationParams(query: unknown): PaginationParams {
  return paginationSchema.parse(query);
}

export function buildPaginationMeta(total: number, page: number, limit: number): PaginationMeta {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

export function getPrismaSkipTake(page: number, limit: number): { skip: number; take: number } {
  return {
    skip: (page - 1) * limit,
    take: limit,
  };
}
