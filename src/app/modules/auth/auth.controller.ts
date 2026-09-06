import type { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import * as authService from './auth.service';
import { signAccessToken, generateRefreshToken } from '../../lib/jwt';
import { hashToken } from '../../lib/argon2';
import { prisma } from '../../lib/prisma';
import { sendSuccess, sendCreated } from '../../utils/response';
import { env } from '../../config/env';

export async function register(req: Request, res: Response): Promise<void> {
  const { user, tokens } = await authService.register(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  sendCreated(res, { user, ...tokens }, 'Registration successful');
}

export async function login(req: Request, res: Response): Promise<void> {
  const { user, tokens } = await authService.login(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  sendSuccess(res, { user, ...tokens }, 'Login successful');
}

export async function refreshToken(req: Request, res: Response): Promise<void> {
  const { refreshToken: rawToken } = req.body as { refreshToken: string };
  const tokens = await authService.refreshTokens(rawToken, { ip: req.ip, userAgent: req.headers['user-agent'] });
  sendSuccess(res, tokens, 'Token refreshed');
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken: rawToken } = req.body as { refreshToken: string };
  await authService.logout(req.user!.id, rawToken);
  sendSuccess(res, null, 'Logged out successfully');
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  await authService.changePassword(req.user!.id, req.body);
  sendSuccess(res, null, 'Password changed successfully');
}

// ── Google OAuth handlers ─────────────────────────────────────────────────────

export function googleAuth(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate('google', { scope: ['email', 'profile'], state: 'logiflow' })(req, res, next);
}

export function googleCallback(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate('google', { session: false }, async (err: Error | null, user: { id: string; role: string } | null) => {
    try {
      if (err || !user) {
        const msg = encodeURIComponent(err?.message ?? 'Google authentication failed');
        res.redirect(`${env.FRONTEND_URL}/auth/error?message=${msg}`);
        return;
      }

      const accessToken = signAccessToken({ sub: user.id, role: user.role });
      const rawRefreshToken = generateRefreshToken();
      const hashedRefreshToken = await hashToken(rawRefreshToken);
      const tokenPrefix = rawRefreshToken.substring(0, 16);

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 7);

      await prisma.refreshToken.create({
        data: {
          token: hashedRefreshToken,
          tokenPrefix,
          userId: user.id,
          expiresAt,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
        },
      });

      res.redirect(`${env.FRONTEND_URL}/auth/callback?accessToken=${accessToken}&refreshToken=${rawRefreshToken}`);
    } catch (callbackErr) {
      next(callbackErr);
    }
  })(req, res, next);
}
