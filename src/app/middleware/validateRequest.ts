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
 * Strips unknown fields from body. Returns structured field-level errors on failure.
 */
export const validateRequest = (schemas: ValidationSchemas) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const parts: RequestPart[] = ['body', 'params', 'query'];

    for (const part of parts) {
      const schema = schemas[part];
      if (!schema) continue;

      const result = schema.safeParse(req[part]);

      if (!result.success) {
        const fieldErrors = result.error.issues.map((e) => ({
          field: e.path.join('.') || part,
          message: e.message,
        }));
        return next(new ValidationError(`Validation failed on ${part}`, fieldErrors));
      }

      req[part] = result.data as typeof req[typeof part];
    }

    next();
  };
};

export const validateBody = (schema: z.ZodTypeAny) => validateRequest({ body: schema });
export const validateParams = (schema: z.ZodTypeAny) => validateRequest({ params: schema });
