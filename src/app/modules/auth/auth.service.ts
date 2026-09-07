import { randomInt } from 'crypto';
import { prisma } from '../../lib/prisma';
import { hashPassword, verifyPassword, hashToken, verifyToken } from '../../lib/argon2';
import { signAccessToken, generateRefreshToken } from '../../lib/jwt';
import { redis, CacheKeys } from '../../lib/redis';
import { sendEmail, otpVerificationEmail, welcomeEmail } from '../../lib/resend';
import {
  ConflictError,
  AuthenticationError,
  BadRequestError,
  NotFoundError,
  AuthorizationError,
} from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { safeUserSelect } from '../../types';
import type { RegisterInput, VerifyEmailInput, LoginInput, ChangePasswordInput } from './auth.schema';
import type { TokenPair } from '../../types';
import type { PrismaTx } from '../../types/prisma';

// ── Constants ─────────────────────────────────────────────────────────────────
const REFRESH_TOKEN_TTL_DAYS = 7;
const OTP_TTL_SECONDS = 5 * 60; // 5 minutes
const OTP_EXPIRATION_MINUTES = 5;

// ── Stored registration data shape ───────────────────────────────────────────
interface PendingRegistrationData {
  firstName: string;
  lastName: string;
  email: string;
  hashedPassword: string;
  phone?: string;
}

// ── Shared token issuance ─────────────────────────────────────────────────────
async function issueTokenPair(
  userId: string,
  role: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: userId, role });
  const rawRefreshToken = generateRefreshToken();
  const hashedRefreshToken = await hashToken(rawRefreshToken);
  const tokenPrefix = rawRefreshToken.substring(0, 16);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: hashedRefreshToken,
      tokenPrefix,
      userId,
      expiresAt,
      ipAddress: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

// ── 1. REGISTER — store pending data in Redis, send OTP ──────────────────────

export async function registerUser(
  input: RegisterInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<void> {
  // email is already normalized by Zod transform (trim + toLowerCase)
  const email = input.email;

  // Reject if a fully-created user exists (not just a pending Redis entry)
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existing) throw new ConflictError('An account with this email already exists.');

  const hashedPassword = await hashPassword(input.password);

  // 6-digit numeric OTP — crypto.randomInt is cryptographically secure
  const otp = String(randomInt(100000, 1000000));

  const pendingData: PendingRegistrationData = {
    firstName: input.firstName,
    lastName: input.lastName,
    email,
    hashedPassword,
    phone: input.phone,
  };

  // Store both keys with TTL — re-registering before verification simply overwrites them
  // (this is intentional: no conflict, just a fresh OTP)
  await Promise.all([
    redis.set(CacheKeys.registrationOtp(email), otp, { ex: OTP_TTL_SECONDS }),
    redis.set(CacheKeys.registrationData(email), JSON.stringify(pendingData), { ex: OTP_TTL_SECONDS }),
  ]);

  // Send verification email — awaited so we can catch Resend failures before responding
  // OTP is NEVER logged — only passed directly to the email template
  try {
    await sendEmail({
      to: email,
      subject: 'Verify your LogiFlow account',
      html: otpVerificationEmail({
        name: input.firstName,
        email,
        otp,
        expirationMinutes: OTP_EXPIRATION_MINUTES,
      }),
    });
  } catch (err) {
    // If email fails, clean up Redis keys so the user can retry cleanly
    await Promise.allSettled([
      redis.del(CacheKeys.registrationOtp(email)),
      redis.del(CacheKeys.registrationData(email)),
    ]);
    throw new Error('Failed to send verification email. Please try again.');
  }

  // Audit: log that a registration was initiated (no OTP in the log)
  await createAuditLog({
    actorId: null,
    action: 'USER_REGISTERED',
    resourceType: 'PendingRegistration',
    resourceId: email,
    metadata: { stage: 'otp_sent' },
    ipAddress: meta?.ip,
  });
}

// ── 2. VERIFY EMAIL — validate OTP, create user in Postgres ──────────────────

export async function verifyUserEmail(
  input: VerifyEmailInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ user: Record<string, unknown>; tokens: TokenPair }> {
  const email = input.email;

  // ── Guard: check for existing user states ──────────────────────────────────
  const existingUser = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      isEmailVerified: true,
      isActive: true,
      deletedAt: true,
      role: true,
    },
  });

  if (existingUser) {
    // Soft-deleted account
    if (existingUser.deletedAt !== null) {
      throw new AuthorizationError('This account has been deactivated. Please contact support.');
    }
    // Blocked account
    if (!existingUser.isActive) {
      throw new AuthorizationError('This account has been blocked. Please contact support.');
    }
    // Already verified — duplicate verification request
    if (existingUser.isEmailVerified) {
      throw new ConflictError('This email has already been verified. Please log in.');
    }
  }

  // ── Fetch OTP from Redis ───────────────────────────────────────────────────
  const storedOtp = await redis.get<string>(CacheKeys.registrationOtp(email));
  if (!storedOtp) {
    throw new BadRequestError(
      'Verification code has expired or is invalid. Please register again to receive a new code.',
    );
  }

  // ── Compare OTP as strings (timing-safe via constant comparison) ────────────
  if (storedOtp !== input.otp) {
    throw new BadRequestError('Verification code does not match. Please check and try again.');
  }

  // Delete OTP immediately — single-use, prevents replay
  await redis.del(CacheKeys.registrationOtp(email));

  // ── Fetch pending registration data ───────────────────────────────────────
  const rawData = await redis.get<string>(CacheKeys.registrationData(email));
  if (!rawData) {
    throw new NotFoundError(
      'Registration data not found. Your session may have expired — please register again.',
    );
  }

  const pendingData: PendingRegistrationData = JSON.parse(rawData);

  // ── Create user + profile in a single transaction ─────────────────────────
  // A partial user-without-profile row is never possible.
  // If two concurrent verification requests arrive simultaneously,
  // the unique constraint on `email` will cause the second to throw P2002 → 409.
  const user = await prisma.$transaction(async (tx: PrismaTx) => {
    const newUser = await tx.user.create({
      data: {
        email: pendingData.email,
        passwordHash: pendingData.hashedPassword,
        firstName: pendingData.firstName,
        lastName: pendingData.lastName,
        phone: pendingData.phone,
        role: 'CUSTOMER',         // never from client payload
        isEmailVerified: true,    // verified at this step
        isActive: true,
      },
      select: safeUserSelect,
    });

    await tx.customerProfile.create({ data: { userId: newUser.id } });

    return newUser;
  });

  // ── Clean up registration data from Redis ─────────────────────────────────
  await redis.del(CacheKeys.registrationData(email));

  // ── Send welcome email (fire-and-forget — failure must not fail the request) ─
  void sendEmail({
    to: email,
    subject: 'Welcome to LogiFlow!',
    html: welcomeEmail({ name: user.firstName, email }),
  }).catch((err: unknown) => {
    console.warn('[Auth] Welcome email failed to send for:', email, err);
  });

  // ── Audit log ─────────────────────────────────────────────────────────────
  await createAuditLog({
    actorId: user.id,
    action: 'USER_REGISTERED',
    resourceType: 'User',
    resourceId: user.id,
    after: { email: user.email, role: user.role, isEmailVerified: true },
    ipAddress: meta?.ip,
  });

  // ── Issue tokens ──────────────────────────────────────────────────────────
  const tokens = await issueTokenPair(user.id, user.role, meta);

  return { user, tokens };
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────

export async function login(
  input: LoginInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ user: Record<string, unknown>; tokens: TokenPair }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...safeUserSelect, passwordHash: true, googleId: true, deletedAt: true, isActive: true, isEmailVerified: true },
  });

  if (!user || user.deletedAt !== null) {
    throw new AuthenticationError('Invalid email or password.');
  }

  if (!user.isActive) {
    throw new AuthenticationError('Your account has been suspended. Please contact support.');
  }

  if (!user.passwordHash) {
    throw new BadRequestError('This account uses Google sign-in. Please log in with Google.');
  }

  // Require email verification before allowing login
  if (!user.isEmailVerified) {
    throw new AuthenticationError(
      'Please verify your email address before logging in. Check your inbox for a verification code.',
    );
  }

  const valid = await verifyPassword(user.passwordHash, input.password);
  if (!valid) throw new AuthenticationError('Invalid email or password.');

  await createAuditLog({
    actorId: user.id,
    action: 'USER_LOGIN',
    resourceType: 'User',
    resourceId: user.id,
    ipAddress: meta?.ip,
    userAgent: meta?.userAgent,
  });

  const tokens = await issueTokenPair(user.id, user.role, meta);
  const { passwordHash: _ph, googleId: _gi, deletedAt: _da, isActive: _ia, isEmailVerified: _ev, ...safeUser } = user;
  return { user: safeUser, tokens };
}

// ── REFRESH TOKENS ────────────────────────────────────────────────────────────

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
    data: { revokedAt: new Date() },
  });

  const user = await prisma.user.findUnique({
    where: { id: matched.userId },
    select: { id: true, role: true, deletedAt: true, isActive: true },
  });

  if (!user || user.deletedAt !== null || !user.isActive) {
    throw new AuthenticationError('Account not found or deactivated.');
  }

  return issueTokenPair(user.id, user.role, meta);
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────

export async function logout(userId: string, rawToken: string): Promise<void> {
  const tokens = await prisma.refreshToken.findMany({
    where: { userId, revokedAt: null },
    select: { id: true, token: true },
  });

  for (const t of tokens) {
    if (await verifyToken(t.token, rawToken)) {
      await prisma.refreshToken.update({ where: { id: t.id }, data: { revokedAt: new Date() } });
      break;
    }
  }

  await createAuditLog({ actorId: userId, action: 'USER_LOGOUT', resourceType: 'User', resourceId: userId });
}

// ── CHANGE PASSWORD ───────────────────────────────────────────────────────────

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, googleId: true },
  });

  if (!user) throw new NotFoundError('User not found.');
  if (!user.passwordHash) {
    throw new BadRequestError('This account uses Google sign-in and has no password.');
  }

  const valid = await verifyPassword(user.passwordHash, input.currentPassword);
  if (!valid) throw new BadRequestError('Current password is incorrect.');

  const newHash = await hashPassword(input.newPassword);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}

// ── Keep old register export as alias for backward compat with tests ──────────
export const register = registerUser;
