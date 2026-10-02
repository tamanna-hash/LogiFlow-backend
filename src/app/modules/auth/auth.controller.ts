import type { NextFunction, Request, Response } from 'express';
import passport from 'passport';
import * as authService from './auth.service';
import { sendSuccess, sendCreated } from '../../utils/response';
import { env } from '../../config/env';

// ── Registration — step 1: send OTP ──────────────────────────────────────────
export async function register(req: Request, res: Response): Promise<void> {
  await authService.registerUser(req.body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  sendCreated(res, null, 'Verification code sent. Please check your email and enter the 6-digit code.');
}

// ── Registration — step 2: verify OTP, create account ────────────────────────
export async function verifyEmail(req: Request, res: Response): Promise<void> {
  const { user, tokens } = await authService.verifyUserEmail(
    req.body,
    { ip: req.ip, userAgent: req.headers['user-agent'] },
  );
  sendCreated(res, { user, ...tokens }, 'Email verified. Your account is now active.');
}

// ── Login ─────────────────────────────────────────────────────────────────────
export async function login(req: Request, res: Response): Promise<void> {
  const { user, tokens } = await authService.login(
    req.body,
    { ip: req.ip, userAgent: req.headers['user-agent'] },
  );
  sendSuccess(res, { user, ...tokens }, 'Login successful');
}

// ── Token refresh ─────────────────────────────────────────────────────────────
export async function refreshToken(req: Request, res: Response): Promise<void> {
  const { refreshToken: rawToken } = req.body as { refreshToken: string };
  const tokens = await authService.refreshTokens(rawToken, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  sendSuccess(res, tokens, 'Token refreshed');
}

// ── Logout ────────────────────────────────────────────────────────────────────
export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken: rawToken } = req.body as { refreshToken: string };
  await authService.logout(req.user!.id, rawToken);
  sendSuccess(res, null, 'Logged out successfully');
}

// ── Change password ───────────────────────────────────────────────────────────
export async function changePassword(req: Request, res: Response): Promise<void> {
  await authService.changePassword(req.user!.id, req.body);
  sendSuccess(res, null, 'Password changed successfully');
}

// ── Set password (Google-only users creating their first password) ────────────
export async function setPassword(req: Request, res: Response): Promise<void> {
  await authService.setPassword(req.user!.id, req.body, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });
  sendSuccess(res, null, 'Password set successfully. You can now sign in with email and password.');
}

// ── Google OAuth — initiation ─────────────────────────────────────────────────
export function googleAuth(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate('google', { scope: ['email', 'profile'], state: 'logiflow' })(req, res, next);
}

// ── Google OAuth — callback ───────────────────────────────────────────────────
// Uses the shared issueTokenPair from auth.service so token logic lives in one place.
export function googleCallback(req: Request, res: Response, next: NextFunction): void {
  passport.authenticate(
    'google',
    { session: false },
    async (err: Error | null, user: { id: string; role: string } | null) => {
      try {
        if (err || !user) {
          const msg = encodeURIComponent(err?.message ?? 'Google authentication failed');
          res.redirect(`${env.FRONTEND_URL}/error?message=${msg}`);
          return;
        }

        // Reuse the shared token issuer — no inline token duplication
        const tokens = await authService.issueTokenPair(user.id, user.role, {
          ip:        req.ip,
          userAgent: req.headers['user-agent'],
        });

        res.redirect(
          `${env.FRONTEND_URL}/callback?accessToken=${tokens.accessToken}&refreshToken=${tokens.refreshToken}`,
        );
      } catch (callbackErr) {
        next(callbackErr);
      }
    },
  )(req, res, next);
}
