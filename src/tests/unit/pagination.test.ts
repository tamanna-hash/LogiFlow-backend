import { describe, it, expect } from 'vitest';
import {
  buildPaginationMeta, getPrismaSkipTake, paginationSchema,
} from '../../app/utils/pagination';

describe('Pagination Utils', () => {
  describe('buildPaginationMeta', () => {
    it('calculates totalPages correctly', () => {
      const meta = buildPaginationMeta(100, 1, 10);
      expect(meta.totalPages).toBe(10);
      expect(meta.total).toBe(100);
      expect(meta.page).toBe(1);
      expect(meta.limit).toBe(10);
    });

    it('handles non-divisible total', () => {
      const meta = buildPaginationMeta(25, 1, 10);
      expect(meta.totalPages).toBe(3);
    });

    it('handles zero total', () => {
      const meta = buildPaginationMeta(0, 1, 10);
      expect(meta.totalPages).toBe(0);
    });
  });

  describe('getPrismaSkipTake', () => {
    it('returns skip=0 for page 1', () => {
      const { skip, take } = getPrismaSkipTake(1, 10);
      expect(skip).toBe(0);
      expect(take).toBe(10);
    });

    it('returns correct skip for page 3', () => {
      const { skip, take } = getPrismaSkipTake(3, 10);
      expect(skip).toBe(20);
      expect(take).toBe(10);
    });
  });

  describe('paginationSchema', () => {
    it('defaults to page=1 limit=10', () => {
      const result = paginationSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(10);
    });

    it('coerces string numbers', () => {
      const result = paginationSchema.parse({ page: '2', limit: '20' });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(20);
    });

    it('rejects limit > 100', () => {
      expect(() => paginationSchema.parse({ limit: '200' })).toThrow();
    });

    it('rejects page=0', () => {
      expect(() => paginationSchema.parse({ page: '0' })).toThrow();
    });
  });
});
