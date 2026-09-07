import { Router } from 'express';
import { authenticate } from '../../middleware/checkAuth';
import { validateRequest } from '../../middleware/validateRequest';
import { rateLimiter } from '../../lib/rateLimiter';
import * as controller from './auth.controller';
import {
  registerSchema,
  verifyEmailSchema,
  loginSchema,
  refreshTokenSchema,
  logoutSchema,
  changePasswordSchema,
} from './auth.schema';

const router = Router();

// ── Step 1: initiate registration — send OTP ──────────────────────────────────
router.post(
  '/register',
  rateLimiter('register'),
  validateRequest({ body: registerSchema }),
  controller.register,
);

// ── Step 2: verify OTP — create account & issue tokens ────────────────────────
router.post(
  '/verify-email',
  rateLimiter('register'), // reuse register bucket — same abuse vector
  validateRequest({ body: verifyEmailSchema }),
  controller.verifyEmail,
);

// ── Login ─────────────────────────────────────────────────────────────────────
router.post(
  '/login',
  rateLimiter('login'),
  validateRequest({ body: loginSchema }),
  controller.login,
);

// ── Token management ──────────────────────────────────────────────────────────
router.post('/refresh', validateRequest({ body: refreshTokenSchema }), controller.refreshToken);
router.post('/logout', authenticate, validateRequest({ body: logoutSchema }), controller.logout);

// ── Google OAuth ──────────────────────────────────────────────────────────────
router.get('/google', controller.googleAuth);
router.get('/google/callback', controller.googleCallback);

// ── Password management ───────────────────────────────────────────────────────
router.patch(
  '/change-password',
  authenticate,
  rateLimiter('changePassword'),
  validateRequest({ body: changePasswordSchema }),
  controller.changePassword,
);

export default router;
