import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errors';
import { env } from '../config/env';

// Lazy-load Prisma error classes to avoid import path issues when generated
// client is not yet present (e.g. first build before prisma generate)
function getPrismaErrors() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Prisma } = require('../../generated/prisma') as { Prisma: {
      PrismaClientKnownRequestError: new (...args: unknown[]) => Error & { code: string; meta?: Record<string, unknown> };
      PrismaClientValidationError: new (...args: unknown[]) => Error;
      PrismaClientInitializationError: new (...args: unknown[]) => Error & { errorCode?: string };
    }};
    return Prisma;
  } catch {
    return null;
  }
}

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

  // ── Prisma errors ──────────────────────────────────────────────────────────
  const Prisma = getPrismaErrors();

  if (Prisma) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      let statusCode = 400;
      let message = 'Database error';
      const prismaErr = err as Error & { code: string; meta?: Record<string, unknown> };

      switch (prismaErr.code) {
        case 'P2002': {
          const target = (prismaErr.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
          message = `Duplicate value — a record with this ${target} already exists.`;
          statusCode = 409;
          break;
        }
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
          message = isDev ? `Prisma error ${prismaErr.code}: ${prismaErr.message}` : 'Database error.';
      }

      res.status(statusCode).json({
        success: false,
        message,
        errors: [],
        ...(isDev && { prismaCode: prismaErr.code, stack: prismaErr.stack }),
      });
      return;
    }

    if (err instanceof Prisma.PrismaClientValidationError) {
      const e = err as Error;
      res.status(400).json({
        success: false,
        message: 'Invalid data provided to the database.',
        errors: [],
        ...(isDev && { stack: e.stack }),
      });
      return;
    }

    if (err instanceof Prisma.PrismaClientInitializationError) {
      const e = err as Error;
      console.error('[DB] Initialization error:', e.message);
      res.status(503).json({
        success: false,
        message: 'Database connection failed.',
        errors: [],
      });
      return;
    }
  }

  // ── Multer errors ──────────────────────────────────────────────────────────
  if (err instanceof Error && err.message.includes('File too large')) {
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
