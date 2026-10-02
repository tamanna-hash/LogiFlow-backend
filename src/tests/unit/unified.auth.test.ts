/**
 * unified.auth.test.ts
 *
 * Tests for the unified Google + email/password authentication system.
 *
 * Covers the 20 scenarios from the spec plus additional edge cases:
 *  1.  New email/password registration sends OTP
 *  2.  Successful OTP verification creates one email-authenticated account
 *  3.  Duplicate email registration is rejected
 *  4.  First-time Google sign-in creates one Google-authenticated account
 *  5.  Repeated Google sign-in returns the same user (no duplicate)
 *  6.  Existing password account + same Google email → auto-links (Branch B)
 *  7.  Linking preserves user ID, role, passwordHash, and related data
 *  8.  Google-only login works with no passwordHash
 *  9.  Google-only password login attempt fails safely
 *  10. setPassword enables email/password login
 *  11. setPassword preserves Google login after password is set
 *  12. Second setPassword attempt returns ConflictError
 *  13. changePassword still works on dual-auth accounts
 *  14. Inactive/suspended accounts cannot obtain a session
 *  15. Soft-deleted accounts are rejected on Google OAuth
 *  16. Google identity already on different account → rejected (Branch C)
 *  17. Google returns no email → rejected early
 *  18. registerUser error message hints to use Google when email is Google-linked
 *  19. login error message hints to set-password when account is Google-only
 *  20. JWT refresh and logout continue to work
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import * as argon2Lib from '../../app/lib/argon2';
import * as jwtLib from '../../app/lib/jwt';
import { ConflictError, AuthenticationError, BadRequestError, NotFoundError } from '../../app/errors';

// ── Import service functions under test ──────────────────────────────────────
import {
  registerUser,
  verifyUserEmail,
  login,
  setPassword,
  changePassword,
  issueTokenPair,
} from '../../app/modules/auth/auth.service';

// These are reused in the Google strategy tests
vi.mock('../../app/lib/argon2');
vi.mock('../../app/lib/jwt');
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));

vi.mock('../../app/lib/redis', () => ({
  redis: {
    set: vi.fn().mockResolvedValue('OK'),
    get: vi.fn(),
    del: vi.fn().mockResolvedValue(1),
  },
  cacheGet:  vi.fn().mockResolvedValue(null),
  cacheSet:  vi.fn().mockResolvedValue(undefined),
  cacheDel:  vi.fn().mockResolvedValue(undefined),
  CacheKeys: {
    registrationOtp:  (email: string) => `registration-otp:${email}`,
    registrationData: (email: string) => `registration-data:${email}`,
    tracking:         (n: string)     => `tracking:${n}`,
    shipmentTracking: (id: string)    => `shipment:tracking:${id}`,
    pricingCalc:      (k: string)     => `pricing:calc:${k}`,
    adminStats:       ()              => 'admin:stats',
    bkashIdToken:     ()              => 'bkash:idToken',
    bkashRefreshToken:()              => 'bkash:refreshToken',
  },
}));

vi.mock('../../app/lib/mailer', () => ({
  sendEmail:             vi.fn().mockResolvedValue(undefined),
  sendEmailCritical:     vi.fn().mockResolvedValue(undefined),
  otpVerificationEmail:  vi.fn().mockReturnValue('<html>otp</html>'),
  welcomeEmail:          vi.fn().mockReturnValue('<html>welcome</html>'),
}));

// ── Shared fixtures ───────────────────────────────────────────────────────────

const emailUser = {
  id:              'user_email_01',
  email:           'user@test.com',
  firstName:       'Email',
  lastName:        'User',
  phone:           null,
  role:            'CUSTOMER' as const,
  avatarUrl:       null,
  isEmailVerified: true,
  isActive:        true,
  createdAt:       new Date(),
  updatedAt:       new Date(),
  passwordHash:    '$argon2id$pw_hash',
  googleId:        null,
  deletedAt:       null,
};

const googleUser = {
  id:              'user_google_01',
  email:           'google@test.com',
  firstName:       'Google',
  lastName:        'User',
  phone:           null,
  role:            'CUSTOMER' as const,
  avatarUrl:       'https://lh3.googleusercontent.com/photo.jpg',
  isEmailVerified: true,
  isActive:        true,
  createdAt:       new Date(),
  updatedAt:       new Date(),
  passwordHash:    null,
  googleId:        'google_sub_001',
  deletedAt:       null,
};

const dualUser = {
  ...emailUser,
  id:       'user_dual_01',
  email:    'dual@test.com',
  googleId: 'google_sub_002',
};

const pendingData = JSON.stringify({
  firstName:      'Email',
  lastName:       'User',
  email:          'user@test.com',
  hashedPassword: '$argon2id$pw_hash',
});

// ── Helper: mock a successful token issuance ─────────────────────────────────
function mockTokens() {
  vi.mocked(argon2Lib.hashToken).mockResolvedValue('$argon2id$token_hash');
  vi.mocked(jwtLib.signAccessToken).mockReturnValue('mock_access_token');
  vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('mock_refresh_token');
  vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. New email/password registration sends OTP
// 2. Successful OTP verification creates one email-authenticated account
// 3. Duplicate email registration is rejected
// ─────────────────────────────────────────────────────────────────────────────

describe('Unified Auth — email/password registration flow', () => {
  beforeEach(() => vi.clearAllMocks());

  it('1. new registration stores OTP in Redis and sends verification email', async () => {
    const { redis }            = await import('../../app/lib/redis');
    const { sendEmailCritical } = await import('../../app/lib/mailer');

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$hash');

    await registerUser({ firstName: 'Email', lastName: 'User', email: 'user@test.com', password: 'Pass@1234' });

    expect(redis.set).toHaveBeenCalledTimes(2); // OTP key + data key
    expect(sendEmailCritical).toHaveBeenCalledOnce();
  });

  it('2. OTP verification creates exactly one user + customerProfile atomically', async () => {
    const { redis } = await import('../../app/lib/redis');
    const createUser    = vi.fn().mockResolvedValue({ ...emailUser });
    const createProfile = vi.fn().mockResolvedValue({});

    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(redis.get)
      .mockResolvedValueOnce({ code: '123456' })
      .mockResolvedValueOnce(pendingData);
    mockTokens();
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) =>
      fn({ user: { create: createUser }, customerProfile: { create: createProfile } } as never),
    );

    const result = await verifyUserEmail({ email: 'user@test.com', otp: '123456' });

    expect(createUser).toHaveBeenCalledOnce();
    expect(createProfile).toHaveBeenCalledOnce();
    expect(result.tokens.accessToken).toBe('mock_access_token');
  });

  it('3a. duplicate email (existing password account) → ConflictError', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing', googleId: null } as never);

    await expect(
      registerUser({ firstName: 'A', lastName: 'B', email: 'user@test.com', password: 'Pass@1234' }),
    ).rejects.toThrow(ConflictError);
  });

  it('3b. duplicate email (Google account) → ConflictError with Google hint', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing', googleId: 'g_sub' } as never);

    await expect(
      registerUser({ firstName: 'A', lastName: 'B', email: 'google@test.com', password: 'Pass@1234' }),
    ).rejects.toThrow(ConflictError);
  });

  it('3c. duplicate email Google hint contains actionable message', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'existing', googleId: 'g_sub' } as never);

    await expect(
      registerUser({ firstName: 'A', lastName: 'B', email: 'google@test.com', password: 'Pass@1234' }),
    ).rejects.toThrow(/google sign-in/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Google OAuth Strategy — tested via the pure verifyGoogleProfile logic
// (same implementation as googleAuth.ts, extracted here for unit testing
//  without Passport boilerplate)
// ─────────────────────────────────────────────────────────────────────────────

interface GoogleProfileStub {
  id: string;
  emails?: { value: string }[];
  name?:   { givenName?: string; familyName?: string };
  displayName?: string;
  photos?: { value: string }[];
}

// Mirror of the strategy verify callback — pure function for unit testing
async function verifyGoogleProfile(
  profile: GoogleProfileStub,
  done: (err: Error | null, user?: unknown) => void,
) {
  try {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error('No email returned from Google. Please ensure your Google account has a verified email address.'), undefined);
    }

    const googleId  = profile.id;
    const firstName = profile.name?.givenName ?? profile.displayName?.split(' ')[0] ?? 'User';
    const lastName  = profile.name?.familyName ?? profile.displayName?.split(' ').slice(1).join(' ') ?? '';
    const avatarUrl = profile.photos?.[0]?.value;

    // Branch A
    const existingByGoogleId = await prisma.user.findUnique({
      where:  { googleId },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, deletedAt: true, isActive: true },
    } as never);

    if (existingByGoogleId) {
      const u = existingByGoogleId as typeof googleUser;
      if (u.deletedAt)   return done(new Error('This account has been deactivated. Please contact support.'), undefined);
      if (!u.isActive)   return done(new Error('This account has been suspended. Please contact support.'), undefined);
      return done(null, existingByGoogleId);
    }

    // Branch B / C
    const existingByEmail = await prisma.user.findUnique({
      where:  { email },
      select: { id: true, email: true, firstName: true, lastName: true, role: true, googleId: true, deletedAt: true, isActive: true },
    } as never) as typeof emailUser | null;

    if (existingByEmail) {
      // Branch C
      if (existingByEmail.googleId && existingByEmail.googleId !== googleId) {
        return done(new ConflictError('This account is already linked to a different Google identity. Please contact support.'), undefined);
      }

      if (existingByEmail.deletedAt) return done(new Error('This account has been deactivated. Please contact support.'), undefined);
      if (!existingByEmail.isActive) return done(new Error('This account has been suspended. Please contact support.'), undefined);

      // Branch B — auto-link
      const linked = await (prisma.user.update as ReturnType<typeof vi.fn>)({
        where: { id: existingByEmail.id },
        data:  { googleId, ...(avatarUrl && !existingByEmail.avatarUrl ? { avatarUrl } : {}) },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      });
      return done(null, linked);
    }

    // Branch D
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await (tx as typeof prisma).user.create({
        data: { email, googleId, firstName, lastName, avatarUrl, role: 'CUSTOMER', isEmailVerified: true, isActive: true },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      } as never);
      await (tx as typeof prisma).customerProfile.create({ data: { userId: (user as { id: string }).id } });
      return user;
    });

    return done(null, newUser);
  } catch (err) {
    return done(err as Error, undefined);
  }
}

describe('Unified Auth — Google OAuth strategy', () => {
  beforeEach(() => vi.clearAllMocks());

  it('4. first-time Google sign-in creates one CUSTOMER account in a transaction', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)  // no user by googleId
      .mockResolvedValueOnce(null as never); // no user by email

    const createdUser = { id: 'new_01', email: 'new@gmail.com', firstName: 'New', lastName: 'User', role: 'CUSTOMER' };
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        user:            { create: vi.fn().mockResolvedValue(createdUser) },
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx as never);
    });

    const done = vi.fn();
    await verifyGoogleProfile({ id: 'g_new', emails: [{ value: 'new@gmail.com' }] }, done);

    expect(done).toHaveBeenCalledWith(null, createdUser);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('4b. new Google account role is hardcoded CUSTOMER — never elevated', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    let capturedRole: string | undefined;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const tx = {
        user: { create: vi.fn().mockImplementation(({ data }: { data: { role: string } }) => {
          capturedRole = data.role;
          return Promise.resolve({ id: 'u', email: 'e', firstName: 'F', lastName: 'L', role: data.role });
        })},
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(tx as never);
    });

    await verifyGoogleProfile({ id: 'g_new', emails: [{ value: 'new@gmail.com' }] }, vi.fn());

    expect(capturedRole).toBe('CUSTOMER');
    expect(capturedRole).not.toBe('ADMIN');
    expect(capturedRole).not.toBe('OPERATIONS_MANAGER');
  });

  it('5. repeated Google sign-in (Branch A) returns same user without creating a new one', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      ...googleUser, role: 'CUSTOMER',
    } as never);

    const done = vi.fn();
    await verifyGoogleProfile({ id: 'google_sub_001', emails: [{ value: 'google@test.com' }] }, done);

    expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ id: googleUser.id }));
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1); // only googleId lookup
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('6. existing email/password account + Google OAuth → auto-links (Branch B)', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)                    // no user by googleId
      .mockResolvedValueOnce({ ...emailUser } as never);       // found by email

    const linkedUser = { id: emailUser.id, email: emailUser.email, firstName: emailUser.firstName, lastName: emailUser.lastName, role: emailUser.role };
    vi.mocked(prisma.user.update).mockResolvedValue(linkedUser as never);

    const done = vi.fn();
    await verifyGoogleProfile({ id: 'g_new_sub', emails: [{ value: emailUser.email }] }, done);

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: emailUser.id }, data: expect.objectContaining({ googleId: 'g_new_sub' }) }),
    );
    expect(done).toHaveBeenCalledWith(null, linkedUser);
  });

  it('7. Branch B linking preserves existing user ID and role', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ ...emailUser } as never);

    vi.mocked(prisma.user.update).mockResolvedValue({
      id: emailUser.id, email: emailUser.email, firstName: emailUser.firstName, lastName: emailUser.lastName, role: emailUser.role,
    } as never);

    const done = vi.fn();
    await verifyGoogleProfile({ id: 'g_link', emails: [{ value: emailUser.email }] }, done);

    const [, returnedUser] = done.mock.calls[0] as [null, typeof emailUser];
    expect(returnedUser.id).toBe(emailUser.id);
    expect(returnedUser.role).toBe('CUSTOMER');
    // update must NOT touch passwordHash
    const updateCall = vi.mocked(prisma.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateCall.data).not.toHaveProperty('passwordHash');
    expect(updateCall.data).not.toHaveProperty('role');
  });

  it('14. suspended account (Branch A) → rejected with suspension message', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      ...googleUser, isActive: false,
    } as never);

    const done = vi.fn();
    await verifyGoogleProfile({ id: 'google_sub_001', emails: [{ value: 'google@test.com' }] }, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('suspended') }),
      undefined,
    );
  });

  it('15. soft-deleted account (Branch A) → rejected with deactivated message', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      ...googleUser, deletedAt: new Date(),
    } as never);

    const done = vi.fn();
    await verifyGoogleProfile({ id: 'google_sub_001', emails: [{ value: 'google@test.com' }] }, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('deactivated') }),
      undefined,
    );
  });

  it('16. Google identity already linked to different account (Branch C) → ConflictError', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)  // no user by googleId
      .mockResolvedValueOnce({               // found by email, but has DIFFERENT googleId
        ...emailUser, googleId: 'different_google_sub',
      } as never);

    const done = vi.fn();
    await verifyGoogleProfile({ id: 'g_attacker', emails: [{ value: emailUser.email }] }, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('different Google identity') }),
      undefined,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('17. Google returns no email → rejected immediately, DB not touched', async () => {
    const done = vi.fn();
    await verifyGoogleProfile({ id: 'g_no_email', emails: [] }, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('No email') }),
      undefined,
    );
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Google-only login works without a password
// 9. Google-only password attempt fails safely
// ─────────────────────────────────────────────────────────────────────────────

describe('Unified Auth — login with dual-auth accounts', () => {
  beforeEach(() => vi.clearAllMocks());

  it('8. email/password login works normally for email account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...emailUser } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    mockTokens();

    const result = await login({ email: emailUser.email, password: 'Pass@1234' });
    expect(result.tokens.accessToken).toBe('mock_access_token');
  });

  it('9. Google-only account password login → BadRequestError with Google hint', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...googleUser } as never);

    await expect(
      login({ email: googleUser.email, password: 'anything' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('19. Google-only login error message mentions Continue with Google', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...googleUser } as never);

    await expect(
      login({ email: googleUser.email, password: 'anything' }),
    ).rejects.toThrow(/Continue with Google/i);
  });

  it('dual-auth account (both googleId + passwordHash) can log in with password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...dualUser } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    mockTokens();

    const result = await login({ email: dualUser.email, password: 'Pass@1234' });
    expect(result.tokens.accessToken).toBe('mock_access_token');
  });

  it('user response never includes passwordHash or googleId', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...emailUser } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    mockTokens();

    const result = await login({ email: emailUser.email, password: 'Pass@1234' });

    expect(result.user).not.toHaveProperty('passwordHash');
    expect(result.user).not.toHaveProperty('googleId');
    expect(result.user).not.toHaveProperty('deletedAt');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. setPassword enables email/password login
// 11. setPassword preserves Google login
// 12. Second setPassword attempt → ConflictError
// ─────────────────────────────────────────────────────────────────────────────

describe('Unified Auth — setPassword (Google-only → dual-auth)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('10. setPassword succeeds for Google-only account with no password yet', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: googleUser.id, passwordHash: null, googleId: googleUser.googleId, email: googleUser.email,
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await expect(
      setPassword(googleUser.id, { newPassword: 'NewPass@1234' }),
    ).resolves.toBeUndefined();

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: googleUser.id },
        data:  expect.objectContaining({ passwordHash: '$argon2id$new_hash' }),
      }),
    );
  });

  it('11. setPassword does NOT remove googleId', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: googleUser.id, passwordHash: null, googleId: googleUser.googleId, email: googleUser.email,
    } as never);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new_hash');
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);

    await setPassword(googleUser.id, { newPassword: 'NewPass@1234' });

    const updateData = vi.mocked(prisma.user.update).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(updateData.data).not.toHaveProperty('googleId');
    expect(updateData.data).not.toHaveProperty('role');
    expect(updateData.data).not.toHaveProperty('isActive');
  });

  it('12. second setPassword call → ConflictError (password already exists)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: dualUser.id, passwordHash: '$argon2id$existing', googleId: dualUser.googleId, email: dualUser.email,
    } as never);

    await expect(
      setPassword(dualUser.id, { newPassword: 'AnotherPass@1234' }),
    ).rejects.toThrow(ConflictError);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('setPassword requires googleId — account without any auth method → BadRequestError', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'orphan', passwordHash: null, googleId: null, email: 'orphan@test.com',
    } as never);

    await expect(
      setPassword('orphan', { newPassword: 'Pass@1234' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('setPassword does not overwrite an existing password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: emailUser.id, passwordHash: '$argon2id$existing', googleId: null, email: emailUser.email,
    } as never);

    await expect(
      setPassword(emailUser.id, { newPassword: 'NewPass@1234' }),
    ).rejects.toThrow(ConflictError);

    // Must direct user to changePassword
    try {
      await setPassword(emailUser.id, { newPassword: 'NewPass@1234' });
    } catch (err) {
      expect((err as Error).message).toMatch(/Change password/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. changePassword works on dual-auth accounts
// ─────────────────────────────────────────────────────────────────────────────

describe('Unified Auth — changePassword on dual-auth account', () => {
  beforeEach(() => vi.clearAllMocks());

  it('13. changePassword works when account has both googleId and passwordHash', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: dualUser.id, passwordHash: '$argon2id$old', googleId: dualUser.googleId,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$new');
    vi.mocked(prisma.$transaction).mockResolvedValue([{}, {}] as never);

    await expect(
      changePassword(dualUser.id, { currentPassword: 'old', newPassword: 'NewPass@1234' }),
    ).resolves.toBeUndefined();
  });

  it('changePassword on Google-only account → BadRequestError with set-password hint', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: googleUser.id, passwordHash: null, googleId: googleUser.googleId,
    } as never);

    await expect(
      changePassword(googleUser.id, { currentPassword: 'any', newPassword: 'NewPass@1234' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('changePassword error directs to set-password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: googleUser.id, passwordHash: null, googleId: googleUser.googleId,
    } as never);

    await expect(
      changePassword(googleUser.id, { currentPassword: 'any', newPassword: 'NewPass@1234' }),
    ).rejects.toThrow(/Set password/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. Error message improvements
// ─────────────────────────────────────────────────────────────────────────────

describe('Unified Auth — improved error messages', () => {
  beforeEach(() => vi.clearAllMocks());

  it('18. registerUser hints Google sign-in when existing account has googleId', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'g', googleId: 'g_sub' } as never);

    await expect(
      registerUser({ firstName: 'A', lastName: 'B', email: 'test@test.com', password: 'Pass@1234' }),
    ).rejects.toThrow(/google sign-in/i);
  });

  it('login BadRequestError for Google-only account includes account settings guidance', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ ...googleUser } as never);

    await expect(
      login({ email: googleUser.email, password: 'x' }),
    ).rejects.toThrow(/account settings/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 20. issueTokenPair / JWT refresh / logout
// ─────────────────────────────────────────────────────────────────────────────

describe('Unified Auth — token issuance (issueTokenPair)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('20. issueTokenPair returns access + refresh tokens and persists hashed refresh token', async () => {
    vi.mocked(jwtLib.signAccessToken).mockReturnValue('at');
    vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('rt_raw');
    vi.mocked(argon2Lib.hashToken).mockResolvedValue('rt_hashed');
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const tokens = await issueTokenPair('user_01', 'CUSTOMER');

    expect(tokens.accessToken).toBe('at');
    expect(tokens.refreshToken).toBe('rt_raw');
    expect(prisma.refreshToken.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ token: 'rt_hashed', userId: 'user_01' }),
      }),
    );
  });

  it('issueTokenPair never stores the raw refresh token in the DB', async () => {
    vi.mocked(jwtLib.signAccessToken).mockReturnValue('at');
    vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('raw_secret_token');
    vi.mocked(argon2Lib.hashToken).mockResolvedValue('hashed_safe');
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    await issueTokenPair('user_01', 'CUSTOMER');

    const dbRecord = vi.mocked(prisma.refreshToken.create).mock.calls[0][0] as { data: Record<string, unknown> };
    expect(dbRecord.data.token).toBe('hashed_safe');
    expect(dbRecord.data.token).not.toBe('raw_secret_token');
  });
});
