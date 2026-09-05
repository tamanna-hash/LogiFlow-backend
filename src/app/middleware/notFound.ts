import type { Request, Response } from 'express';

/**
 * 404 handler — mounted after all routes.
 * Returns LogiFlow standard error response format.
 */
export const notFound = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl}`,
    errors: [],
  });
};
