import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors';
import { env } from '../config/env';

/**
 * Global error handler — the last middleware in the Express chain.
 * Handles: AppError subclasses, Prisma errors, JWT errors, and unknown errors.
 * In production: hides internal details. In development: exposes stack + raw error.
 */
export const globalErrorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const isDev = env.NODE_ENV === 'development';

  if (isDev) {
    console.error('[Error]', err);
  }

  // ── AppError (our own typed errors) ────────────────────────────────────────
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      success: false,
      message: err.message,
      errors: err.errors ?? [],
      ...(isDev && { stack: err.stack }),
    });
    return;
  }

  // ── Prisma known request errors ────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    let statusCode = 400;
    let message = 'Database error';

    switch (err.code) {
      case 'P2002':
        message = `Duplicate value — a record with this ${(err.meta?.target as string[])?.join(', ') ?? 'field'} already exists.`;
        statusCode = 409;
        break;
      case 'P2003':
        message = 'Related record not found (foreign key constraint failed).';
        break;
      case 'P2025':
        message = 'Record not found.';
        statusCode = 404;
        break;
      case 'P2014':
        message = 'The change you are trying to make would violate a required relation.';
        break;
      default:
        message = isDev ? `Prisma error ${err.code}: ${err.message}` : 'Database error.';
    }

    res.status(statusCode).json({
      success: false,
      message,
      errors: [],
      ...(isDev && { prismaCode: err.code, stack: err.stack }),
    });
    return;
  }

  // ── Prisma validation errors ───────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({
      success: false,
      message: 'Invalid data provided to the database.',
      errors: [],
      ...(isDev && { stack: err.stack }),
    });
    return;
  }

  // ── Prisma initialization errors ───────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientInitializationError) {
    console.error('[DB] Initialization error:', err.message);
    res.status(503).json({
      success: false,
      message: 'Database connection failed.',
      errors: [],
    });
    return;
  }

  // ── Multer errors (file upload) ────────────────────────────────────────────
  if (
    err instanceof Error &&
    err.message.includes('File too large')
  ) {
    res.status(413).json({
      success: false,
      message: 'File too large. Maximum allowed size is 5MB.',
      errors: [],
    });
    return;
  }

  // ── Unknown / unhandled errors ─────────────────────────────────────────────
  const message = isDev && err instanceof Error ? err.message : 'Internal server error.';

  res.status(500).json({
    success: false,
    message,
    errors: [],
    ...(isDev && err instanceof Error && { stack: err.stack }),
  });
};
