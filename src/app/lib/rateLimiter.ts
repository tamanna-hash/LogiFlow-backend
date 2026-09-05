import { Ratelimit } from '@upstash/ratelimit';
import type { NextFunction, Request, Response } from 'express';
import { redis } from './redis';

// ── Rate limiter instances ────────────────────────────────────────────────────

const limiters = {
  // Auth endpoints — strict
  login: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, '15 m'),
    prefix: 'rl:login',
  }),
  register: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '1 h'),
    prefix: 'rl:register',
  }),
  changePassword: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '15 m'),
    prefix: 'rl:change-password',
  }),

  // Payment — prevent abuse
  paymentInitiate: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(5, '10 m'),
    prefix: 'rl:payment',
  }),

  // Public tracking endpoint
  publicTracking: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
    prefix: 'rl:tracking',
  }),

  // General authenticated API
  authenticated: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, '1 m'),
    prefix: 'rl:auth-api',
  }),

  // General unauthenticated API
  unauthenticated: new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, '1 m'),
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
