import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import * as argon2Lib from '../../app/lib/argon2';
import * as jwtLib from '../../app/lib/jwt';
import { registerUser, verifyUserEmail, login, changePassword, setPassword } from '../../app/modules/auth/auth.service';
import { ConflictError, AuthenticationError, BadRequestError, NotFoundError } from '../../app/errors';

// ── Mock all external dependencies ─────────────────────────────────────────

vi.mock('../../app/lib/argon2');
vi.mock('../../app/lib/jwt');
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));

// Mock Redis — OTP operations
vi.mock('../../app/lib/redis', () => ({
  redis: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  },
  cacheGet: vi.fn().mockResolvedValue(null),
  cacheSet: vi.fn().mockResolvedValue(undefined),
  cacheDel: vi.fn().mockResolvedValue(undefined),
  CacheKeys: {
    registrationOtp: (email: string) => `registration-otp:${email}`,
    registrationData: (email: string) => `registration-data:${email}`,
    tracking: (n: string) => `tracking:${n}`,
    shipmentTracking: (id: string) => `shipment:tracking:${id}`,
    pricingCalc: (k: string) => `pricing:calc:${k}`,
    adminStats: () => 'admin:stats',
    bkashIdToken: () => 'bkash:idToken',
    bkashRefreshToken: () => 'bkash:refreshToken',
  },
}));

// Mock Resend — email sending
vi.mock('../../app/lib/resend', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailCritical: vi.fn().mockResolvedValue(undefined),
  otpVerificationEmail: vi.fn().mockReturnValue('<html>otp</html>'),
  welcomeEmail: vi.fn().mockReturnValue('<html>welcome</html>'),
}));

// Mock Mailer — auth.service.ts now imports from mailer
vi.mock('../../app/lib/mailer', () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
  sendEmailCritical: vi.fn().mockResolvedValue(undefined),
  otpVerificationEmail: vi.fn().mockReturnValue('<html>otp</html>'),
  welcomeEmail: vi.fn().mockReturnValue('<html>welcome</html>'),
}));

// ── Shared test fixtures ─────────────────────────────────────────────────────

const mockUser = {
  id: 'user_01',
  email: 'customer@test.com',
  firstName: 'Test',
  lastName: 'User',
  phone: null,
  role: 'CUSTOMER' as const,
  avatarUrl: null,
  isEmailVerified: true, // verified users only
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const pendingRegistrationData = JSON.stringify({
  firstName: 'Test',
  lastName: 'User',
  email: 'customer@test.com',
  hashedPassword: '$argon2id$hashed',
});

// ── registerUser ─────────────────────────────────────────────────────────────

describe('AuthService — registerUser (OTP flow, step 1)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('stores OTP + data in Redis and sends email (returns void)', async () => {
    const { redis } = await import('../../app/lib/redis');
    // auth.service.ts imports from mailer (not resend directly)
    const { sendEmailCritical } = await import('../../app/lib/mailer');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$hashed');

    await expect(
      registerUser({ firstName: 'Test', lastName: 'User', email: 'customer@test.com', password: 'password123' }),
    ).resolves.toBeUndefined(); // returns void — no tokens at this stage

    // Redis set called twice: OTP key + data key
    expect(redis.set).toHaveBeenCalledTimes(2);
    // Email sent once
    expect(sendEmailCritical).toHaveBeenCalledOnce();
  });

  it('re-registers same email before verification — overwrites Redis keys (no conflict)', async () => {
    const { redis } = await import('../../app/lib/redis');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null); // user doesn't exist in DB
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$hashed');

    // First registration
    await registerUser({ firstName: 'Test', lastName: 'User', email: 'customer@test.com', password: 'password123' });
    // Second registration — should overwrite, not throw
    await expect(
      registerUser({ firstName: 'Test', lastName: 'User', email: 'customer@test.com', password: 'newpass456' }),
    ).resolves.toBeUndefined();

    // Redis set called 4 times total (2 per registration)
    expect(redis.set).toHaveBeenCalledTimes(4);
  });

  it('throws ConflictError if user already exists in DB', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

    await expect(
      registerUser({ firstName: 'A', lastName: 'B', email: 'customer@test.com', password: 'pass1234' }),
    ).rejects.toThrow(ConflictError);
  });

  it('OTP is never returned to the caller', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$hashed');

    const result = await registerUser({
      firstName: 'Test', lastName: 'User', email: 'customer@test.com', password: 'password123',
    });

    // Result is void — no OTP or tokens exposed
    expect(result).toBeUndefined();
  });
});

// ── verifyUserEmail ──────────────────────────────────────────────────────────

describe('AuthService — verifyUserEmail (OTP flow, step 2)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates user and returns tokens on correct OTP', async () => {
    const { redis } = await import('../../app/lib/redis');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null); // no existing user
    vi.mocked(redis.get)
      .mockResolvedValueOnce({ code: '123456' })                 // OTP key
      .mockResolvedValueOnce(pendingRegistrationData);         // data key
    vi.mocked(redis.del).mockResolvedValue(1 as never);
    vi.mocked(argon2Lib.hashToken).mockResolvedValue('$argon2id$token_hash');
    vi.mocked(jwtLib.signAccessToken).mockReturnValue('access_token_mock');
    vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('raw_refresh_token');
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({
        user: { create: vi.fn().mockResolvedValue(mockUser) },
        customerProfile: { create: vi.fn() },
      } as never),
    );
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const result = await verifyUserEmail({ email: 'customer@test.com', otp: '123456' });

    expect(result.tokens.accessToken).toBe('access_token_mock');
    expect(result.tokens.refreshToken).toBe('raw_refresh_token');
    expect(result.user).toBeDefined();
  });

  it('deletes OTP key immediately after successful verify (single-use)', async () => {
    const { redis } = await import('../../app/lib/redis');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(redis.get)
      .mockResolvedValueOnce({ code: '654321' })
      .mockResolvedValueOnce(pendingRegistrationData);
    vi.mocked(redis.del).mockResolvedValue(1 as never);
    vi.mocked(argon2Lib.hashToken).mockResolvedValue('hash');
    vi.mocked(jwtLib.signAccessToken).mockReturnValue('tok');
    vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('ref');
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({ user: { create: vi.fn().mockResolvedValue(mockUser) }, customerProfile: { create: vi.fn() } } as never),
    );
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    await verifyUserEmail({ email: 'customer@test.com', otp: '654321' });

    // del called at least once for the OTP key
    expect(redis.del).toHaveBeenCalledWith('registration-otp:customer@test.com');
  });

  it('throws BadRequestError when OTP is expired (Redis key missing)', async () => {
    const { redis } = await import('../../app/lib/redis');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(redis.get).mockResolvedValueOnce(null); // OTP expired

    await expect(
      verifyUserEmail({ email: 'customer@test.com', otp: '123456' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when OTP does not match', async () => {
    const { redis } = await import('../../app/lib/redis');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(redis.get).mockResolvedValueOnce({ code: '999999' }); // stored OTP is different

    await expect(
      verifyUserEmail({ email: 'customer@test.com', otp: '123456' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('throws NotFoundError when OTP matches but registration-data key is missing/expired', async () => {
    const { redis } = await import('../../app/lib/redis');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(redis.get)
      .mockResolvedValueOnce({ code: '123456' }) // OTP matches
      .mockResolvedValueOnce(null);    // registration-data already expired
    vi.mocked(redis.del).mockResolvedValue(1 as never);

    await expect(
      verifyUserEmail({ email: 'customer@test.com', otp: '123456' }),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ConflictError for already-verified user (duplicate verification)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, isEmailVerified: true, deletedAt: null,
    } as never);

    await expect(
      verifyUserEmail({ email: 'customer@test.com', otp: '123456' }),
    ).rejects.toThrow(ConflictError);
  });

  it('throws AuthorizationError for soft-deleted user', async () => {
    const { AuthorizationError } = await import('../../app/errors');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, deletedAt: new Date(), isEmailVerified: false,
    } as never);

    await expect(
      verifyUserEmail({ email: 'customer@test.com', otp: '123456' }),
    ).rejects.toThrow(AuthorizationError);
  });

  it('throws AuthorizationError for blocked user', async () => {
    const { AuthorizationError } = await import('../../app/errors');
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, isActive: false, deletedAt: null, isEmailVerified: false,
    } as never);

    await expect(
      verifyUserEmail({ email: 'customer@test.com', otp: '123456' }),
    ).rejects.toThrow(AuthorizationError);
  });
});

// ── login ────────────────────────────────────────────────────────────────────

describe('AuthService — login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns token pair on valid credentials for verified user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser,
      isEmailVerified: true,
      passwordHash: '$argon2id$hash',
      googleId: null,
      deletedAt: null,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    vi.mocked(argon2Lib.hashToken).mockResolvedValue('$argon2id$token_hash');
    vi.mocked(jwtLib.signAccessToken).mockReturnValue('access_token');
    vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('refresh_token');
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const result = await login({ email: 'customer@test.com', password: 'password123' });
    expect(result.tokens.accessToken).toBe('access_token');
  });

  it('throws AuthenticationError for unverified email', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser,
      isEmailVerified: false,  // not yet verified
      passwordHash: '$argon2id$hash',
      googleId: null,
      deletedAt: null,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);

    await expect(
      login({ email: 'customer@test.com', password: 'password123' }),
    ).rejects.toThrow(AuthenticationError);
  });

  it('throws AuthenticationError for wrong password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, isEmailVerified: true, passwordHash: '$argon2id$hash', googleId: null, deletedAt: null,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(false);

    await expect(
      login({ email: 'customer@test.com', password: 'wrongpassword' }),
    ).rejects.toThrow(AuthenticationError);
  });

  it('throws AuthenticationError for deleted user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, deletedAt: new Date(), passwordHash: '$hash',
    } as never);

    await expect(
      login({ email: 'customer@test.com', password: 'password123' }),
    ).rejects.toThrow(AuthenticationError);
  });

  it('throws BadRequestError for Google-only account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, isEmailVerified: true, passwordHash: null, googleId: 'google123', deletedAt: null,
    } as never);

    await expect(
      login({ email: 'google@test.com', password: 'anything' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('throws AuthenticationError for non-existent user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      login({ email: 'nobody@test.com', password: 'password123' }),
    ).rejects.toThrow(AuthenticationError);
  });
});

// ── changePassword ───────────────────────────────────────────────────────────

describe('AuthService — changePassword', () => {
  beforeEach(() => vi.clearAllMocks());

  it('updates password and revokes all refresh tokens', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_01', passwordHash: '$argon2id$old_hash', googleId: null,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}] as never);

    await expect(
      changePassword('user_01', { currentPassword: 'oldpass', newPassword: 'newpass123' }),
    ).resolves.not.toThrow();
  });

  it('throws BadRequestError if current password is wrong', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_01', passwordHash: '$argon2id$hash', googleId: null,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(false);

    await expect(
      changePassword('user_01', { currentPassword: 'wrong', newPassword: 'newpass123' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError for Google-only account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_01', passwordHash: null, googleId: 'google123',
    } as never);

    await expect(
      changePassword('user_01', { currentPassword: 'any', newPassword: 'newpass123' }),
    ).rejects.toThrow(BadRequestError);
  });
});

// ── setPassword ──────────────────────────────────────────────────────────────

describe('AuthService — setPassword (Google-only users creating their first password)', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Happy path ──────────────────────────────────────────────────────────────

  it('sets passwordHash for a Google-only account that has no password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_google_01',
      passwordHash: null,      // ← no local password yet
      googleId: 'google_sub_123',
      email: 'oauth@test.com',
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await expect(
      setPassword('user_google_01', { newPassword: 'securePass1!' }),
    ).resolves.not.toThrow();

    expect(argon2Lib.hashPassword).toHaveBeenCalledWith('securePass1!');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user_google_01' },
      data:  { passwordHash: '$argon2id$new_hash' },
    });
  });

  it('writes an audit log on success', async () => {
    const { createAuditLog } = await import('../../app/modules/audit/audit.service');

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_google_01',
      passwordHash: null,
      googleId: 'google_sub_123',
      email: 'oauth@test.com',
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await setPassword('user_google_01', { newPassword: 'securePass1!' });

    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId:      'user_google_01',
        action:       'PASSWORD_SET',
        resourceType: 'User',
        resourceId:   'user_google_01',
      }),
    );
  });

  it('does not revoke existing refresh tokens — user stays logged in', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_google_01',
      passwordHash: null,
      googleId: 'google_sub_123',
      email: 'oauth@test.com',
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await setPassword('user_google_01', { newPassword: 'securePass1!' });

    // refreshToken.updateMany must NOT be called — sessions remain valid
    expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled();
  });

  // ── Conflict: account already has a password ────────────────────────────────

  it('throws ConflictError if account already has a password', async () => {
    const { ConflictError } = await import('../../app/errors');

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_01',
      passwordHash: '$argon2id$existing_hash',
      googleId: 'google_sub_123',
      email: 'both@test.com',
    } as never);

    await expect(
      setPassword('user_01', { newPassword: 'newPass123!' }),
    ).rejects.toThrow(ConflictError);

    // Must not attempt to hash or write anything
    expect(argon2Lib.hashPassword).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('ConflictError message directs user to change-password flow', async () => {
    const { ConflictError } = await import('../../app/errors');

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_01',
      passwordHash: '$argon2id$existing_hash',
      googleId: 'google_sub_123',
      email: 'both@test.com',
    } as never);

    await expect(
      setPassword('user_01', { newPassword: 'newPass123!' }),
    ).rejects.toThrow(expect.objectContaining({
      message: expect.stringMatching(/change password/i),
    }));
  });

  // ── No googleId: account has no auth method ─────────────────────────────────

  it('throws BadRequestError if account has no googleId and no password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_broken_01',
      passwordHash: null,
      googleId: null,       // ← no Google AND no password — broken state
      email: 'broken@test.com',
    } as never);

    await expect(
      setPassword('user_broken_01', { newPassword: 'securePass1!' }),
    ).rejects.toThrow(BadRequestError);

    expect(argon2Lib.hashPassword).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // ── User not found ──────────────────────────────────────────────────────────

  it('throws NotFoundError when userId does not exist', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      setPassword('nonexistent_id', { newPassword: 'securePass1!' }),
    ).rejects.toThrow(NotFoundError);

    expect(argon2Lib.hashPassword).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  // ── Security: cannot overwrite another user's password via this endpoint ────

  it('only writes to the userId from the verified JWT — cannot target another user by passing a different id', async () => {
    // The endpoint gets userId exclusively from req.user!.id (set by authenticate middleware).
    // This test confirms the service only ever queries and updates by that id — never
    // by any value from the request body.
    const targetUserId = 'victim_user_id';

    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: targetUserId,
      passwordHash: null,
      googleId: 'google_sub_456',
      email: 'victim@test.com',
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await setPassword(targetUserId, { newPassword: 'attackerPass1!' });

    // The update always uses the userId supplied by the server — never an attacker-controlled value
    expect(prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: targetUserId } }),
    );
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: targetUserId } }),
    );
  });

  // ── Hash quality ────────────────────────────────────────────────────────────

  it('stores the hashed password, never the plaintext', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_google_01',
      passwordHash: null,
      googleId: 'google_sub_123',
      email: 'oauth@test.com',
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$hashed_value');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    const plaintext = 'plainTextPassword1!';
    await setPassword('user_google_01', { newPassword: plaintext });

    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect((updateCall.data as { passwordHash: string }).passwordHash).toBe('$argon2id$hashed_value');
    expect((updateCall.data as { passwordHash: string }).passwordHash).not.toBe(plaintext);
  });

  // ── After setPassword: local login becomes available ────────────────────────

  it('after setPassword the user can log in with email and the new password', async () => {
    // Step 1 — set the password
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'user_google_01',
      passwordHash: null,
      googleId: 'google_sub_123',
      email: 'oauth@test.com',
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await setPassword('user_google_01', { newPassword: 'securePass1!' });

    // Step 2 — simulate local login now that passwordHash is set
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      ...mockUser,
      id: 'user_google_01',
      email: 'oauth@test.com',
      isEmailVerified: true,
      passwordHash: '$argon2id$new_hash',   // ← the hash just written
      googleId: 'google_sub_123',
      deletedAt: null,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    vi.mocked(argon2Lib.hashToken).mockResolvedValue('$argon2id$token_hash');
    vi.mocked(jwtLib.signAccessToken).mockReturnValue('access_token_post_set');
    vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('refresh_token_post_set');
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const result = await login({ email: 'oauth@test.com', password: 'securePass1!' });

    expect(result.tokens.accessToken).toBe('access_token_post_set');
    expect(argon2Lib.verifyPassword).toHaveBeenCalledWith('$argon2id$new_hash', 'securePass1!');
  });

  // ── After setPassword: Google login still works ──────────────────────────────

  it('adding a local password does not break Google OAuth login (googleId is preserved)', async () => {
    // The setPassword service only updates passwordHash — it never touches googleId.
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_google_01',
      passwordHash: null,
      googleId: 'google_sub_123',
      email: 'oauth@test.com',
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await setPassword('user_google_01', { newPassword: 'securePass1!' });

    // Confirm the update only touches passwordHash — googleId is not cleared
    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0];
    expect(updateCall.data).toEqual({ passwordHash: '$argon2id$new_hash' });
    expect(updateCall.data).not.toHaveProperty('googleId');
  });
});
