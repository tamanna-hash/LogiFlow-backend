import { prisma } from '../../lib/prisma';
import { hashPassword, verifyPassword, hashToken, verifyToken } from '../../lib/argon2';
import { signAccessToken, generateRefreshToken } from '../../lib/jwt';
import {
  ConflictError, AuthenticationError, BadRequestError, NotFoundError,
} from '../../errors';
import { createAuditLog } from '../audit/audit.service';
import { safeUserSelect } from '../../types';
import type { RegisterInput, LoginInput, ChangePasswordInput } from './auth.schema';
import type { TokenPair } from '../../types';
import { env } from '../../config/env';

const REFRESH_TOKEN_TTL_DAYS = 7;

async function issueTokenPair(userId: string, role: string, meta?: { ip?: string; userAgent?: string }): Promise<TokenPair> {
  const accessToken = signAccessToken({ sub: userId, role });
  const rawRefreshToken = generateRefreshToken();
  const hashedRefreshToken = await hashToken(rawRefreshToken);

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFRESH_TOKEN_TTL_DAYS);

  await prisma.refreshToken.create({
    data: {
      token: hashedRefreshToken,
      userId,
      expiresAt,
      ipAddress: meta?.ip,
      userAgent: meta?.userAgent,
    },
  });

  return { accessToken, refreshToken: rawRefreshToken };
}

export async function register(
  input: RegisterInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ user: Record<string, unknown>; tokens: TokenPair }> {
  const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
  if (existing) throw new ConflictError('An account with this email already exists.');

  const passwordHash = await hashPassword(input.password);

  const user = await prisma.$transaction(async (tx) => {
    const newUser = await tx.user.create({
      data: {
        email: input.email,
        passwordHash,
        firstName: input.firstName,
        lastName: input.lastName,
        phone: input.phone,
        role: 'CUSTOMER',
      },
      select: safeUserSelect,
    });
    await tx.customerProfile.create({ data: { userId: newUser.id } });
    return newUser;
  });

  await createAuditLog({
    actorId: user.id,
    action: 'USER_REGISTERED',
    resourceType: 'User',
    resourceId: user.id,
    after: { email: user.email, role: user.role },
    ipAddress: meta?.ip,
  });

  const tokens = await issueTokenPair(user.id, user.role, meta);
  return { user, tokens };
}

export async function login(
  input: LoginInput,
  meta?: { ip?: string; userAgent?: string },
): Promise<{ user: Record<string, unknown>; tokens: TokenPair }> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { ...safeUserSelect, passwordHash: true, googleId: true, deletedAt: true, isActive: true },
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
  const { passwordHash: _ph, googleId: _gi, deletedAt: _da, isActive: _ia, ...safeUser } = user;
  return { user: safeUser, tokens };
}

export async function refreshTokens(
  rawToken: string,
  meta?: { ip?: string; userAgent?: string },
): Promise<TokenPair> {
  // Find all non-revoked tokens for potential match (can't look up by hash directly)
  // Strategy: find candidate tokens by userId — but we don't have userId here.
  // Instead: fetch recent non-revoked tokens and verify against each (max ~5 per user in practice)
  // Better approach: store token identifier prefix in plain + hash the rest.
  // For simplicity and correctness: find by scanning recent non-expired tokens.
  // Production note: to avoid full table scan, store a short token ID alongside the hash.

  // Find all non-revoked, non-expired refresh tokens
  const candidates = await prisma.refreshToken.findMany({
    where: {
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, token: true, userId: true },
    take: 1000, // safety cap — in production add token prefix index
    orderBy: { createdAt: 'desc' },
  });

  let matched: (typeof candidates)[0] | undefined;
  for (const candidate of candidates) {
    if (await verifyToken(candidate.token, rawToken)) {
      matched = candidate;
      break;
    }
  }

  if (!matched) throw new AuthenticationError('Invalid or expired refresh token.');

  // Revoke old token
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

export async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<void> {
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

  // Update password + revoke ALL refresh tokens (force re-login on all devices)
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash: newHash } }),
    prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    }),
  ]);
}
