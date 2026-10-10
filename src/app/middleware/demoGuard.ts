import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { prisma } from '../lib/prisma';

/**
 * demoGuard — read-only enforcement for demo accounts.
 *
 * Any user whose email ends with the configured DEMO_DOMAIN (e.g. @demo.logiflow.app)
 * is treated as a read-only observer. All mutating HTTP methods (POST, PATCH, PUT,
 * DELETE) are blocked with a 403, except for the small whitelist below that is needed
 * for the demo session itself to function (login, logout, token refresh, OAuth).
 *
 * The check is intentionally lightweight:
 *  - GET requests pass immediately — no token decode, no DB hit.
 *  - Whitelisted paths pass immediately.
 *  - For everything else: decode the JWT (no DB verify — the real authenticate
 *    middleware handles that), look up the email by userId (single indexed query),
 *    and block if the email belongs to the demo domain.
 *
 * This middleware runs at the /api/v1 level BEFORE individual route handlers.
 * It is a no-op when DEMO_DOMAIN is not configured.
 */

/**
 * Paths that demo users must be allowed to POST/PATCH/DELETE to so the session
 * itself works. Matched against req.path (relative to the /api/v1 mount).
 */
const ALWAYS_ALLOWED_PATHS = [
  '/auth/login',
  '/auth/refresh',
  '/auth/logout',
  '/auth/google',
  '/auth/google/callback',
  '/auth/register',
  '/auth/verify-email',
  // Stripe/bKash callbacks are server-to-server — no JWT present anyway
  '/payments/stripe/webhook',
  '/payments/bkash/callback',
  // Marking notifications read is a nice UX touch — allow it
  '/notifications/read-all',
];

/** Also allow PATCH /notifications/:id/read */
const NOTIFICATION_READ_RE = /^\/notifications\/[^/]+\/read$/;

export async function demoGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Feature disabled — skip entirely
  if (!env.DEMO_DOMAIN) {
    next();
    return;
  }

  // GET and HEAD are always safe
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }

  // Auth / system paths are always allowed regardless of who is calling
  if (
    ALWAYS_ALLOWED_PATHS.some((p) => req.path === p || req.path.startsWith(p + '/')) ||
    NOTIFICATION_READ_RE.test(req.path)
  ) {
    next();
    return;
  }

  // No Authorization header → not a demo user (unauthenticated request)
  const raw =
    req.cookies?.accessToken ??
    (req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.split(' ')[1]
      : req.headers.authorization);

  if (!raw) {
    next();
    return;
  }

  // Decode without verifying — the downstream authenticate middleware handles
  // full verification. We only need the userId to look up the email.
  let userId: string | undefined;
  try {
    const decoded = jwt.decode(raw);
    if (decoded && typeof decoded === 'object' && typeof decoded.sub === 'string') {
      userId = decoded.sub;
    }
  } catch {
    // Malformed token — let authenticate handle the error
    next();
    return;
  }

  if (!userId) {
    next();
    return;
  }

  // Single indexed lookup — cheap
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });

  if (user?.email.endsWith(`@${env.DEMO_DOMAIN}`)) {
    res.status(403).json({
      success: false,
      message: 'Demo accounts are read-only. This action is not permitted in the demo environment.',
      errors: [],
    });
    return;
  }

  next();
}
