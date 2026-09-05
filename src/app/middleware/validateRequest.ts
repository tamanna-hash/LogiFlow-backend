import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { ValidationError } from '../errors';

type RequestPart = 'body' | 'params' | 'query';

interface ValidationSchemas {
  body?: z.ZodTypeAny;
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
}

/**
 * validateRequest — validates req.body, req.params, and/or req.query with Zod schemas.
 * Strips unknown fields from body (security: no extra data passes through).
 * Returns structured field-level errors on failure.
 *
 * Usage:
 *   validateRequest({ body: createShipmentSchema })
 *   validateRequest({ body: someSchema, query: paginationSchema })
 *   validateRequest({ params: z.object({ id: z.string().cuid() }) })
 */
export const validateRequest = (schemas: ValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parts: RequestPart[] = ['body', 'params', 'query'];

    for (const part of parts) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);

      if (!result.success) {
        const fieldErrors = result.error.errors.map((e) => ({
          field: e.path.join('.') || part,
          message: e.message,
        }));
        return next(new ValidationError(`Validation failed on ${part}`, fieldErrors));
      }

      // Replace the request part with the parsed (and stripped) data
      (req as Record<string, unknown>)[part] = result.data;
    }

    next();
  };
};

/**
 * Convenience — validate body only (most common case)
 */
export const validateBody = (schema: z.ZodTypeAny) => validateRequest({ body: schema });

/**
 * Convenience — validate params only
 */
export const validateParams = (schema: z.ZodTypeAny) => validateRequest({ params: schema });
