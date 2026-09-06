import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import { getMe } from '../../app/modules/user/user.service';
import { login } from '../../app/modules/auth/auth.service';
import { NotFoundError, AuthenticationError } from '../../app/errors';

vi.mock('../../app/modules/audit/audit.service', () => ({ createAuditLog: vi.fn() }));

describe('Soft Delete — User visibility', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getMe throws NotFoundError for soft-deleted user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null); // soft-delete filter returns null

    await expect(getMe('deleted_user_id')).rejects.toThrow(NotFoundError);
  });

  it('login throws AuthenticationError for soft-deleted user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_01',
      email: 'deleted@test.com',
      firstName: 'Del',
      lastName: 'User',
      role: 'CUSTOMER',
      passwordHash: '$argon2id$hash',
      googleId: null,
      deletedAt: new Date('2026-01-01'), // deleted
      isActive: true,
      phone: null,
      avatarUrl: null,
      isEmailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(
      login({ email: 'deleted@test.com', password: 'anypassword' }),
    ).rejects.toThrow(AuthenticationError);
  });

  it('login throws AuthenticationError for inactive user', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user_01',
      email: 'inactive@test.com',
      firstName: 'Inactive',
      lastName: 'User',
      role: 'CUSTOMER',
      passwordHash: '$argon2id$hash',
      googleId: null,
      deletedAt: null,
      isActive: false, // suspended
      phone: null,
      avatarUrl: null,
      isEmailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await expect(
      login({ email: 'inactive@test.com', password: 'anypassword' }),
    ).rejects.toThrow(AuthenticationError);
  });
});
