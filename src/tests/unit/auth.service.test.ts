import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import * as argon2Lib from '../../app/lib/argon2';
import * as jwtLib from '../../app/lib/jwt';
import { register, login, changePassword } from '../../app/modules/auth/auth.service';
import { ConflictError, AuthenticationError, BadRequestError } from '../../app/errors';

vi.mock('../../app/lib/argon2');
vi.mock('../../app/lib/jwt');
vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));
vi.mock('../../app/modules/notification/notification.service', () => ({
  notifyShipmentCreated: vi.fn(),
}));

const mockUser = {
  id: 'user_01',
  email: 'customer@test.com',
  firstName: 'Test',
  lastName: 'User',
  phone: null,
  role: 'CUSTOMER' as const,
  avatarUrl: null,
  isEmailVerified: false,
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService — register', () => {
  beforeEach(() => vi.clearAllMocks());

  it('creates user and returns token pair on valid input', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(argon2Lib.hashPassword).mockResolvedValue('$argon2id$hashed');
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

    const result = await register({
      firstName: 'Test', lastName: 'User',
      email: 'customer@test.com', password: 'password123',
    });

    expect(result.tokens.accessToken).toBe('access_token_mock');
    expect(result.tokens.refreshToken).toBe('raw_refresh_token');
  });

  it('throws ConflictError if email already exists', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(mockUser as never);

    await expect(
      register({ firstName: 'A', lastName: 'B', email: 'customer@test.com', password: 'pass1234' }),
    ).rejects.toThrow(ConflictError);
  });
});

describe('AuthService — login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns token pair on valid credentials', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, passwordHash: '$argon2id$hash', googleId: null, deletedAt: null,
    } as never);
    vi.mocked(argon2Lib.verifyPassword).mockResolvedValue(true);
    vi.mocked(argon2Lib.hashToken).mockResolvedValue('$argon2id$token_hash');
    vi.mocked(jwtLib.signAccessToken).mockReturnValue('access_token');
    vi.mocked(jwtLib.generateRefreshToken).mockReturnValue('refresh_token');
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as never);

    const result = await login({ email: 'customer@test.com', password: 'password123' });
    expect(result.tokens.accessToken).toBe('access_token');
  });

  it('throws AuthenticationError for wrong password', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      ...mockUser, passwordHash: '$argon2id$hash', googleId: null, deletedAt: null,
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
      ...mockUser, passwordHash: null, googleId: 'google123', deletedAt: null,
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
