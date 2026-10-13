import { Ratelimit } from '@upstash/ratelimit';
import type { NextFunction, Request, Response } from 'express';
import { redis } from './redis';

// ── Rate limiter instances ────────────────────────────────────────────────────
//
// Strategy:
//  • Sensitive auth actions (login, register, OTP, password reset) → tight window
//  • Payments → moderate (real users don't retry payments dozens of times)
//  • Public tracking → generous (customer apps poll frequently)
//  • General API → comfortable for real usage without blocking legitimate users

const limiters = {
  // Login — 10 attempts per 15 min per IP/user
  // Prevents brute-force while allowing normal usage (multiple devices, typos)
  login: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '15 m'),
    prefix: 'rl:login',
  }),

  // Register + OTP verify — 5 attempts per 15 min
  // OTPs expire in 5 min, so 5 is plenty; prevents OTP farming
  register: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),
    prefix: 'rl:register',
  }),

  // Password change / set / reset — 5 attempts per 15 min
  // Sensitive; legitimate users never need more than 1-2 per session
  changePassword: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),
    prefix: 'rl:change-password',
  }),

  // Payment initiation — 10 per hour per user
  // Prevents payment spam; real users rarely initiate more than a few per hour
  paymentInitiate: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '1 h'),
    prefix: 'rl:payment',
  }),

  // Public tracking — 60 per minute per IP
  // Customer-facing; apps and users poll this frequently for status updates
  publicTracking: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'rl:tracking',
  }),

  // General authenticated API — 300 per minute per user
  // Dashboard data, shipment lists, notifications etc. — high volume is expected
  authenticated: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(300, '1 m'),
    prefix: 'rl:auth-api',
  }),

  // General unauthenticated API — 60 per minute per IP
  // Public pages, pricing calculator, zone lookup etc.
  unauthenticated: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(60, '1 m'),
    prefix: 'rl:unauth-api',
  }),
} as const;

type LimiterKey = keyof typeof limiters;

/**
 * rateLimiter — Express middleware factory.
 * Key is based on userId (if authenticated) or IP address.
 * Fails open if Upstash is unreachable — logs warning, never blocks the request.
 *
 * Usage: router.post('/login', rateLimiter('login'), controller)
 */
export function rateLimiter(type: LimiterKey) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const identifier =
        req.user?.id ?? req.ip ?? req.headers['x-forwarded-for']?.toString() ?? 'unknown';

      const { success, limit, remaining, reset } = await limiters[type].limit(identifier);

      res.setHeader('X-RateLimit-Limit', limit);
      res.setHeader('X-RateLimit-Remaining', remaining);
      res.setHeader('X-RateLimit-Reset', reset);

      if (!success) {
        const retryAfter = Math.ceil((reset - Date.now()) / 1000);
        res.setHeader('Retry-After', retryAfter);
        res.status(429).json({
          success: false,
          message: 'Too many requests. Please try again later.',
          errors: [],
        });
        return;
      }

      next();
    } catch (err) {
      // Fail open — rate limiting failure should never block a request
      console.warn('[RateLimit] Upstash unavailable, failing open:', err);
      next();
    }
  };
}
