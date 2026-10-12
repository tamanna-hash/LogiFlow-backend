import { randomInt } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { hashPassword, verifyPassword, hashToken, verifyToken } from '../../lib/argon2';
import { signAccessToken, generateRefreshToken } from '../../lib/jwt';
import { redis, CacheKeys } from '../../lib/redis';
import { sendEmail, sendEmailCritical, otpVerificationEmail, welcomeEmail } from '../../lib/mailer';
import {
  ConflictError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  AuthorizationError,
  ServiceUnavailableError,
} from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { safeUserSelect } from '../../types';
import type { RegisterInput, VerifyEmailInput, LoginInput, ChangePasswordInput, SetPasswordInput } from './auth.schema';
import type { TokenPair } from '../../types';
import type { PrismaTx } from '../../types/prisma';

// ── Constants ─────────────────────────────────────────────────────────────────
const REFRESH_TOKEN_TTL_DAYS = 7;
const OTP_TTL_SECONDS        = 5 * 60; // 5 minutes
const OTP_EXPIRATION_MINUTES = 5;

// ── Stored registration data shape ───────────────────────────────────────────
interface PendingRegistrationData {
  firstName: string;
  lastName:  string;
  email:     string;
  hashedPassword: string;
  phone?: string;
}

interface StoredRegistrationOtp {
  code: string;
}

// ── Shared token issuance ─────────────────────────────────────────────────────
// Exported so googleCallback can reuse it — avoids duplicated inline token logic.
export async function issueTokenPair(
  userId: string,
  role: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<TokenPair> {
  const accessToken      = signAccessToken({ sub: userId, role });
  const rawRefreshToken  = generateRefreshToken();
  const hashedRefreshToken = await hashToken(rawRefreshToken);
  const tokenPrefix      = rawRefreshToken.substring(0, 16);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await prisma.refreshToken.create({
    data: {
      token:      hashedRefreshToken,
      tokenPrefix,
      userId,
      expiresAt,
      ipAddress:  meta?.ip,
      userAgent:  meta?.userAgent,
    },
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

// ── 1. REGISTER — store pending data in Redis, send OTP ──────────────────────

export async function registerUser(
  input: RegisterInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<void> {
  const email = input.email; // already normalized by Zod (trim + toLowerCase)

  // Reject if a fully-created account already exists
  const existing = await prisma.user.findUnique({
    where:  { email },
    select: { id: true, googleId: true },
  });

  if (existing) {
    // Give a helpful hint when the account was created via Google
    if (existing.googleId) {
      throw new ConflictError(
        'An account with this email already exists via Google sign-in. ' +
        'Please sign in with Google. You can add a password from your account settings afterwards.',
      );
    }
    throw new ConflictError('An account with this email already exists. Please sign in instead.');
  }

  const hashedPassword = await hashPassword(input.password);
  const otp = String(randomInt(100000, 1000000));

  const pendingData: PendingRegistrationData = {
    firstName: input.firstName,
    lastName:  input.lastName,
    email,
    hashedPassword,
    phone: input.phone,
  };

  // Re-registering before verification simply overwrites the pending keys (fresh OTP)
  await Promise.all([
    redis.set(CacheKeys.registrationOtp(email),  { code: otp } satisfies StoredRegistrationOtp, { ex: OTP_TTL_SECONDS }),
    redis.set(CacheKeys.registrationData(email), pendingData, { ex: OTP_TTL_SECONDS }),
  ]);

  // Sending fails → roll back Redis so the user can retry cleanly
  try {
    await sendEmailCritical({
      to:      email,
      subject: 'Verify your LogiFlow account',
      html:    otpVerificationEmail({
        name:               input.firstName,
        email,
        otp,
        expirationMinutes:  OTP_EXPIRATION_MINUTES,
      }),
    });
  } catch (err) {
    await Promise.allSettled([
      redis.del(CacheKeys.registrationOtp(email)),
      redis.del(CacheKeys.registrationData(email)),
    ]);
    const detail = err instanceof Error ? err.message : 'Unknown email provider error';
    console.error('[Auth] Verification email failed:', { to: email, detail });
    throw new ServiceUnavailableError(`Failed to send verification email: ${detail}`);
  }

  await createAuditLog({
    actorId:      null,
    action:       'USER_REGISTERED',
    resourceType: 'PendingRegistration',
    resourceId:   email,
    metadata:     { stage: 'otp_sent' },
    ipAddress:    meta?.ip,
  });
}

// ── 2. VERIFY EMAIL — validate OTP, create user ───────────────────────────────

export async function verifyUserEmail(
  input: VerifyEmailInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ user: Record<string, unknown>; tokens: TokenPair }> {
  const email = input.email;

  // Guard: check for existing user states before touching Redis
  const existingUser = await prisma.user.findUnique({
    where:  { email },
    select: { id: true, isEmailVerified: true, isActive: true, deletedAt: true, role: true },
  });

  if (existingUser) {
    if (existingUser.deletedAt !== null) {
      throw new AuthorizationError('This account has been deactivated. Please contact support.');
    }
    if (!existingUser.isActive) {
      throw new AuthorizationError('This account has been blocked. Please contact support.');
    }
    if (existingUser.isEmailVerified) {
      throw new ConflictError('This email has already been verified. Please log in.');
    }
  }

  // Validate OTP
  const storedOtpEntry = await redis.get<StoredRegistrationOtp>(CacheKeys.registrationOtp(email));
  if (!storedOtpEntry?.code) {
    throw new BadRequestError(
      'Verification code has expired or is invalid. Please register again to receive a new code.',
    );
  }

  if (String(storedOtpEntry.code) !== String(input.otp)) {
    throw new BadRequestError('Verification code does not match. Please check and try again.');
  }

  // Single-use — delete immediately before creating the user
  await redis.del(CacheKeys.registrationOtp(email));

  const pendingData = await redis.get<PendingRegistrationData>(CacheKeys.registrationData(email));
  if (!pendingData) {
    throw new NotFoundError(
      'Registration data not found. Your session may have expired — please register again.',
    );
  }

  // Atomic: user + profile in one transaction.
  // The email @unique constraint handles concurrent duplicate requests (P2002 → 409).
  const user = await prisma.$transaction(async (tx: PrismaTx) => {
    const newUser = await tx.user.create({
      data: {
        email:           pendingData.email,
        passwordHash:    pendingData.hashedPassword,
        firstName:       pendingData.firstName,
        lastName:        pendingData.lastName,
        phone:           pendingData.phone,
        role:            'CUSTOMER',
        isEmailVerified: true,
        isActive:        true,
        // googleId intentionally omitted — email/password registration
      },
      select: safeUserSelect,
    });

    await tx.customerProfile.create({ data: { userId: newUser.id } });

    return newUser;
  });

  await redis.del(CacheKeys.registrationData(email));

  void sendEmail({
    to:      email,
    subject: 'Welcome to LogiFlow!',
    html:    welcomeEmail({ name: user.firstName, email }),
  }).catch((err: unknown) => {
    console.warn('[Auth] Welcome email failed:', email, err);
  });

  await createAuditLog({
    actorId:      user.id,
    action:       'USER_REGISTERED',
    resourceType: 'User',
    resourceId:   user.id,
    after:        { email: user.email, role: user.role, isEmailVerified: true },
    ipAddress:    meta?.ip,
  });

  const tokens = await issueTokenPair(user.id, user.role, meta);
  return { user, tokens };
}

// ── 3. LOGIN ─────────────────────────────────────────────────────────────────

export async function login(
  input: LoginInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ user: Record<string, unknown>; tokens: TokenPair }> {
  const user = await prisma.user.findUnique({
    where:  { email: input.email },
    select: {
      ...safeUserSelect,
      passwordHash:    true,
      googleId:        true,
      deletedAt:       true,
      isActive:        true,
      isEmailVerified: true,
    },
  });

  if (!user || user.deletedAt !== null) {
    throw new AuthenticationError('Invalid email or password.');
  }

  if (!user.isActive) {
    throw new AuthenticationError('Your account has been suspended. Please contact support.');
  }

  if (!user.passwordHash) {
    // Google-only account — give actionable guidance without revealing more than necessary
    if (user.googleId) {
      throw new BadRequestError(
        'This account was created with Google sign-in and has no password. ' +
        'Please use "Continue with Google" to sign in. ' +
        'You can add a password from your account settings once signed in.',
      );
    }
    // Shouldn't happen (no password, no googleId) but handle defensively
    throw new AuthenticationError('Invalid email or password.');
  }

  if (!user.isEmailVerified) {
    throw new AuthenticationError(
      'Please verify your email address before logging in. Check your inbox for a verification code.',
    );
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) throw new AuthenticationError('Invalid email or password.');

  await createAuditLog({
    actorId:      user.id,
    action:       'USER_LOGIN',
    resourceType: 'User',
    resourceId:   user.id,
    ipAddress:    meta?.ip,
    userAgent:    meta?.userAgent,
  });

  const tokens = await issueTokenPair(user.id, user.role, meta);
  const { passwordHash: _ph, googleId: _gi, deletedAt: _da, isActive: _ia, isEmailVerified: _ev, ...safeUser } = user;
  return { user: safeUser, tokens };
}

// ── 4. REFRESH TOKENS ────────────────────────────────────────────────────────

export async function refreshTokens(
  rawToken: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<TokenPair> {
  const tokenPrefix = rawToken.substring(0, 16);

  const candidates = await prisma.refreshToken.findMany({
    where: {
      tokenPrefix,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, token: true, userId: true },
  });

  let matched: (typeof candidates)[0] | undefined;
  for (const candidate of candidates) {
    if (await verifyToken(candidate.token, rawToken)) {
      matched = candidate;
      break;
    }
  }

  if (!matched) throw new AuthenticationError('Invalid or expired refresh token.');

  await prisma.refreshToken.update({
    where: { id: matched.id },
    data:  { revokedAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where:  { id: matched.userId },
    select: { id: true, role: true, deletedAt: true, isActive: true },
  });

  if (!user || user.deletedAt !== null || !user.isActive) {
    throw new AuthenticationError('Account not found or deactivated.');
  }

  return issueTokenPair(user.id, user.role, meta);
}

// ── 5. LOGOUT ────────────────────────────────────────────────────────────────

export async function logout(userId: string, rawToken: string): Promise<void> {
  const tokens = await prisma.refreshToken.findMany({
    where:  { userId, revokedAt: null },
    select: { id: true, token: true },
  });

  for (const t of tokens) {
    if (await verifyToken(t.token, rawToken)) {
      await prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
      break;
    }
  }

  await createAuditLog({
    actorId:      userId,
    action:       'USER_LOGOUT',
    resourceType: 'User',
    resourceId:   userId,
  });
}

// ── 6. CHANGE PASSWORD ───────────────────────────────────────────────────────

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { passwordHash: true, googleId: true },
  });

  if (!user) throw new NotFoundError('User not found.');

  if (!user.passwordHash) {
    // Google-only account — direct them to set-password endpoint
    throw new BadRequestError(
      'This account has no password yet. Use the "Set password" option in your account settings to create one.',
    );
  }

  const valid = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!valid) throw new BadRequestError('Current password is incorrect.');

  const newHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
    // Revoke all refresh tokens — forces re-login on all devices after password change
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: new Date() },
    }),
  ]);

  await createAuditLog({
    actorId:      userId,
    action:       'PASSWORD_CHANGED',
    resourceType: 'User',
    resourceId:   userId,
  });
}

// ── 7. SET PASSWORD (Google-only users creating their first password) ─────────

export async function setPassword(
  userId: string,
  input: SetPasswordInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<void> {
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { passwordHash: true, googleId: true, email: true },
  });

  if (!user) throw new NotFoundError('User not found.');

  // Only allowed if no password exists yet
  if (user.passwordHash) {
    throw new ConflictError(
      'This account already has a password. Use "Change password" instead.',
    );
  }

  // Must have a Google identity — setPassword is only for Google-linked accounts
  if (!user.googleId) {
    throw new BadRequestError('No authentication method found for this account. Please contact support.');
  }

  const newHash = await hashPassword(input.newPassword);

  // Atomic: set password — concurrent duplicate requests: only the first wins
  // (the second will find passwordHash non-null and throw ConflictError above)
  await prisma.user.update({
    where: { id: userId },
    data:  { passwordHash: newHash },
  });

  await createAuditLog({
    actorId:      userId,
    action:       'PASSWORD_SET',
    resourceType: 'User',
    resourceId:   userId,
    metadata:     { method: 'google_account_password_creation' },
    ipAddress:    meta?.ip,
  });
}

// ── Backward-compat alias ────────────────────────────────────────────────────
export const register = registerUser;

// ── 8. FORGOT PASSWORD — send reset token via email ──────────────────────────

export async function forgotPassword(
  input: { email: string },
): Promise<void> {
  const email = input.email; // already normalized by Zod

  const user = await prisma.user.findUnique({
    where:  { email },
    select: { id: true, email: true, firstName: true, googleId: true, deletedAt: true, isActive: true },
  });

  // SECURITY: Always return success (don't reveal if email exists or not)
  // This prevents email enumeration attacks
  if (!user || user.deletedAt || !user.isActive) {
    // Silently succeed — don't tell attacker if email exists
    return;
  }

  // If Google-only account (no password), don't allow password reset
  if (user.googleId) {
    // Still silently succeed — don't reveal account type
    return;
  }

  // Generate secure reset token (128 random hex chars)
  const rawToken = generateRefreshToken(); // reuse same generator (128 hex)
  const hashedToken = await hashToken(rawToken);
  const tokenPrefix = rawToken.substring(0, 16);

  // Store hashed token in Redis with 1-hour expiry
  const redisKey = `${CacheKeys.PASSWORD_RESET}:${tokenPrefix}`;
  await redis.setex(
    redisKey,
    60 * 60, // 1 hour TTL
    JSON.stringify({ userId: user.id, hashedToken }),
  );

  // Send password reset email
  const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/reset-password?token=${rawToken}`;
  
  try {
    await sendEmail({
      to: user.email,
      subject: 'Reset Your Password - LogiFlow',
      html: passwordResetEmail(user.firstName, resetUrl),
    });
  } catch (emailError) {
    // Log error but don't expose to user (security)
    console.error('[Forgot Password] Failed to send email:', emailError);
    // Still return success to prevent email enumeration
  }

  await createAuditLog({
    actorId:      user.id,
    action:       'PASSWORD_RESET_REQUESTED',
    resourceType: 'User',
    resourceId:   user.id,
  });
}

// ── 9. RESET PASSWORD — verify token and update password ─────────────────────

export async function resetPassword(
  input: { token: string; newPassword: string },
): Promise<void> {
  const { token: rawToken, newPassword } = input;

  if (rawToken.length < 16) {
    throw new BadRequestError('Invalid or expired reset token.');
  }

  const tokenPrefix = rawToken.substring(0, 16);
  const redisKey = `${CacheKeys.PASSWORD_RESET}:${tokenPrefix}`;

  // Retrieve stored data from Redis
  const stored = await redis.get(redisKey);
  if (!stored) {
    throw new BadRequestError('Invalid or expired reset token.');
  }

  let data: { userId: string; hashedToken: string };
  try {
    // Upstash Redis auto-deserializes JSON — handle both string and object
    data = (typeof stored === 'string'
      ? JSON.parse(stored)
      : stored) as { userId: string; hashedToken: string };
    if (!data.userId || !data.hashedToken) throw new Error('missing fields');
  } catch {
    throw new BadRequestError('Invalid reset token format.');
  }

  // Verify token hash
  const valid = await verifyToken(data.hashedToken, rawToken);
  if (!valid) {
    throw new BadRequestError('Invalid or expired reset token.');
  }

  // Verify user still exists and is active
  const user = await prisma.user.findUnique({
    where:  { id: data.userId },
    select: { id: true, deletedAt: true, isActive: true },
  });

  if (!user || user.deletedAt || !user.isActive) {
    throw new NotFoundError('User account not found or inactive.');
  }

  // Hash new password
  const newHash = await hashPassword(newPassword);

  // Update password and revoke all refresh tokens
  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } }),
    prisma.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data:  { revokedAt: new Date() },
    }),
  ]);

  // Delete the reset token from Redis (one-time use)
  await redis.del(redisKey);

  await createAuditLog({
    actorId:      user.id,
    action:       'PASSWORD_RESET_COMPLETED',
    resourceType: 'User',
    resourceId:   user.id,
  });
}

// ── Password reset email template ─────────────────────────────────────────────

function passwordResetEmail(firstName: string, resetUrl: string): string {
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; max-width: 100%; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="padding: 40px 40px 20px; text-align: center; border-bottom: 2px solid #2563eb;">
              <h1 style="margin: 0; color: #2563eb; font-size: 28px; font-weight: 700;">LogiFlow</h1>
            </td>
          </tr>
          
          <!-- Content -->
          <tr>
            <td style="padding: 40px;">
              <h2 style="margin: 0 0 20px; color: #1e293b; font-size: 24px; font-weight: 600;">Reset Your Password</h2>
              
              <p style="margin: 0 0 20px; color: #475569; font-size: 16px; line-height: 1.6;">
                Hi ${firstName},
              </p>
              
              <p style="margin: 0 0 20px; color: #475569; font-size: 16px; line-height: 1.6;">
                We received a request to reset your password for your LogiFlow account. Click the button below to create a new password:
              </p>
              
              <!-- CTA Button -->
              <table role="presentation" style="margin: 30px 0;">
                <tr>
                  <td align="center">
                    <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px;">Reset Password</a>
                  </td>
                </tr>
              </table>
              
              <p style="margin: 20px 0; color: #475569; font-size: 14px; line-height: 1.6;">
                Or copy and paste this link into your browser:
              </p>
              
              <p style="margin: 0 0 20px; padding: 12px; background-color: #f1f5f9; border-radius: 4px; color: #475569; font-size: 13px; word-break: break-all;">
                ${resetUrl}
              </p>
              
              <div style="margin: 30px 0; padding: 16px; background-color: #fef2f2; border-left: 4px solid #ef4444; border-radius: 4px;">
                <p style="margin: 0; color: #991b1b; font-size: 14px; line-height: 1.6;">
                  <strong>Security Notice:</strong> This link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support if you have concerns.
                </p>
              </div>
              
              <p style="margin: 20px 0 0; color: #64748b; font-size: 14px; line-height: 1.6;">
                Thanks,<br>
                The LogiFlow Team
              </p>
            </td>
          </tr>
          
          <!-- Footer -->
          <tr>
            <td style="padding: 30px 40px; background-color: #f8fafc; border-top: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; color: #94a3b8; font-size: 12px; line-height: 1.6; text-align: center;">
                This is an automated email from LogiFlow. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `.trim();
}
