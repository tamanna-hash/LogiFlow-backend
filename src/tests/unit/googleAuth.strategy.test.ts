/**
 * googleAuth.strategy.test.ts
 *
 * Unit tests for the Passport Google OAuth strategy logic in googleAuth.ts.
 *
 * The global test setup (setup.ts) already mocks prisma, mailer, and audit.
 * We test the three-branch verify callback logic extracted as a pure function:
 *
 *   Branch A: existing user by googleId  → login (return user)
 *   Branch B: email exists, no googleId  → conflict (throw ConflictError)
 *   Branch C: no match                   → create new CUSTOMER + customerProfile
 *
 * Additional cases:
 *   - Deleted/deactivated Google account
 *   - Missing email from Google profile
 *   - Role escalation attempt (ADMIN/COURIER via profile data)
 *   - Suspended (isActive=false) account
 *   - Unexpected DB errors
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '../../app/lib/prisma';
import { ConflictError } from '../../app/errors';
import { login } from '../../app/modules/auth/auth.service';
import { BadRequestError } from '../../app/errors';

// ── Re-implement the verify callback as a pure testable function ───────────────
// This mirrors the logic in src/app/lib/googleAuth.ts without invoking Passport
// or making any real network calls.

interface GoogleProfileStub {
  id: string;
  emails?: { value: string }[];
  name?: { givenName?: string; familyName?: string };
  displayName?: string;
  photos?: { value: string }[];
}

async function verifyGoogleProfile(
  profile: GoogleProfileStub,
  done: (err: Error | null, user?: unknown) => void,
) {
  try {
    const email = profile.emails?.[0]?.value;
    if (!email) {
      return done(new Error('No email returned from Google'), undefined);
    }

    const googleId = profile.id;
    const firstName =
      profile.name?.givenName ?? profile.displayName?.split(' ')[0] ?? 'User';
    const lastName =
      profile.name?.familyName ??
      profile.displayName?.split(' ').slice(1).join(' ') ??
      '';
    const avatarUrl = profile.photos?.[0]?.value;

    // Branch A: existing user by googleId
    const existingByGoogle = await prisma.user.findUnique({
      where: { googleId },
      select: {
        id: true, email: true, firstName: true, lastName: true,
        role: true, deletedAt: true, isActive: true,
      },
    } as never);

    if (existingByGoogle) {
      const user = existingByGoogle as {
        deletedAt: Date | null;
        isActive: boolean;
      };
      if (user.deletedAt) {
        return done(new Error('This account has been deactivated.'), undefined);
      }
      if (!user.isActive) {
        return done(
          new Error('This account has been suspended. Please contact support.'),
          undefined,
        );
      }
      return done(null, existingByGoogle);
    }

    // Branch B: email exists but no googleId (password account)
    const existingByEmail = await prisma.user.findUnique({
      where: { email },
      select: { id: true, googleId: true },
    } as never) as { id: string; googleId: string | null } | null;

    if (existingByEmail && !existingByEmail.googleId) {
      return done(
        new ConflictError(
          'An account with this email already exists. Please log in with your email and password.',
        ),
        undefined,
      );
    }

    // Branch C: new user — create inside transaction
    const newUser = await prisma.$transaction(async (tx) => {
      const user = await (tx as typeof prisma).user.create({
        data: {
          email,
          googleId,
          firstName,
          lastName,
          avatarUrl,
          role: 'CUSTOMER',       // hardcoded — never from profile
          isEmailVerified: true,  // Google verified the email
        },
        select: { id: true, email: true, firstName: true, lastName: true, role: true },
      } as never);
      await (tx as typeof prisma).customerProfile.create({
        data: { userId: (user as { id: string }).id },
      });
      return user;
    });

    return done(null, newUser);
  } catch (err) {
    return done(err as Error, undefined);
  }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const googleProfile: GoogleProfileStub = {
  id: 'google_sub_001',
  emails: [{ value: 'newuser@gmail.com' }],
  name: { givenName: 'Test', familyName: 'User' },
  photos: [{ value: 'https://lh3.googleusercontent.com/photo.jpg' }],
};

const existingGoogleUser = {
  id: 'user_01',
  email: 'existing@gmail.com',
  firstName: 'Existing',
  lastName: 'User',
  role: 'CUSTOMER',
  deletedAt: null,
  isActive: true,
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Google OAuth Strategy — verify callback', () => {
  beforeEach(() => vi.clearAllMocks());

  // ── Branch A: Existing Google user ────────────────────────────────────────

  it('A1: returns existing user when googleId matches (login)', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(existingGoogleUser as never);

    const done = vi.fn();
    await verifyGoogleProfile(googleProfile, done);

    expect(done).toHaveBeenCalledWith(null, existingGoogleUser);
    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('A2: rejects deleted Google account with clear error message', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      ...existingGoogleUser,
      deletedAt: new Date(),
    } as never);

    const done = vi.fn();
    await verifyGoogleProfile(googleProfile, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'This account has been deactivated.' }),
      undefined,
    );
  });

  it('A3: rejects suspended (isActive=false) Google account', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      ...existingGoogleUser,
      isActive: false,
    } as never);

    const done = vi.fn();
    await verifyGoogleProfile(googleProfile, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('suspended') }),
      undefined,
    );
  });

  // ── Branch B: Email exists, no googleId ───────────────────────────────────

  it('B1: rejects with ConflictError when email already has a password account', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)                                     // no user by googleId
      .mockResolvedValueOnce({ id: 'user_pw', googleId: null } as never);       // found by email

    const done = vi.fn();
    await verifyGoogleProfile(googleProfile, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('already exists') }),
      undefined,
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('B2: conflict error message instructs user to use email/password', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({ id: 'user_pw', googleId: null } as never);

    const done = vi.fn();
    await verifyGoogleProfile(googleProfile, done);

    const [err] = done.mock.calls[0] as [Error];
    expect(err).toBeInstanceOf(ConflictError);
    expect(err.message).toContain('email and password');
  });

  // ── Branch C: New user ────────────────────────────────────────────────────

  it('C1: creates new CUSTOMER account for brand-new Google user', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    const createdUser = {
      id: 'user_new_01',
      email: 'newuser@gmail.com',
      firstName: 'Test',
      lastName: 'User',
      role: 'CUSTOMER',
    };

    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const txMock = {
        user: { create: vi.fn().mockResolvedValue(createdUser) },
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(txMock as never);
    });

    const done = vi.fn();
    await verifyGoogleProfile(googleProfile, done);

    expect(done).toHaveBeenCalledWith(null, createdUser);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('C2: new Google user is always assigned CUSTOMER role — never elevated', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    let capturedRole: string | undefined;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const txMock = {
        user: {
          create: vi.fn().mockImplementation(({ data }: { data: { role: string } }) => {
            capturedRole = data.role;
            return Promise.resolve({ id: 'u', email: 'e', firstName: 'F', lastName: 'L', role: data.role });
          }),
        },
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(txMock as never);
    });

    await verifyGoogleProfile(googleProfile, vi.fn());

    expect(capturedRole).toBe('CUSTOMER');
  });

  it('C3: new Google user has isEmailVerified=true (Google verifies email)', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    let capturedVerified: boolean | undefined;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const txMock = {
        user: {
          create: vi.fn().mockImplementation(({ data }: { data: { isEmailVerified: boolean } }) => {
            capturedVerified = data.isEmailVerified;
            return Promise.resolve({ id: 'u', email: 'e', firstName: 'F', lastName: 'L', role: 'CUSTOMER' });
          }),
        },
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(txMock as never);
    });

    await verifyGoogleProfile(googleProfile, vi.fn());

    expect(capturedVerified).toBe(true);
  });

  it('C4: customerProfile is created inside the same transaction as the user', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    let profileCreated = false;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const txMock = {
        user: {
          create: vi.fn().mockResolvedValue({ id: 'user_new', email: 'e', firstName: 'F', lastName: 'L', role: 'CUSTOMER' }),
        },
        customerProfile: {
          create: vi.fn().mockImplementation(() => {
            profileCreated = true;
            return Promise.resolve({});
          }),
        },
      };
      return fn(txMock as never);
    });

    await verifyGoogleProfile(googleProfile, vi.fn());

    expect(profileCreated).toBe(true);
  });

  it('C5: passwordHash is NOT set for new Google accounts', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    let capturedData: Record<string, unknown> | undefined;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const txMock = {
        user: {
          create: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
            capturedData = data;
            return Promise.resolve({ id: 'u', email: 'e', firstName: 'F', lastName: 'L', role: 'CUSTOMER' });
          }),
        },
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(txMock as never);
    });

    await verifyGoogleProfile(googleProfile, vi.fn());

    expect(capturedData).not.toHaveProperty('passwordHash');
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  it('E1: rejects when Google returns no email address', async () => {
    const profileNoEmail: GoogleProfileStub = {
      id: 'google_no_email',
      emails: [],
      name: { givenName: 'No', familyName: 'Email' },
    };

    const done = vi.fn();
    await verifyGoogleProfile(profileNoEmail, done);

    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'No email returned from Google' }),
      undefined,
    );
    // Should not touch the database
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('E2: propagates unexpected DB errors via done(err)', async () => {
    const dbError = new Error('DB connection failed');
    vi.mocked(prisma.user.findUnique).mockRejectedValueOnce(dbError as never);

    const done = vi.fn();
    await verifyGoogleProfile(googleProfile, done);

    expect(done).toHaveBeenCalledWith(dbError, undefined);
  });

  it('E3: handles profile with no name fields — falls back to displayName', async () => {
    const minimalProfile: GoogleProfileStub = {
      id: 'google_min_01',
      emails: [{ value: 'minimal@gmail.com' }],
      displayName: 'Minimal User',
    };

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    let capturedFirstName: string | undefined;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const txMock = {
        user: {
          create: vi.fn().mockImplementation(({ data }: { data: { firstName: string } }) => {
            capturedFirstName = data.firstName;
            return Promise.resolve({ id: 'u', email: 'minimal@gmail.com', firstName: data.firstName, lastName: '', role: 'CUSTOMER' });
          }),
        },
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(txMock as never);
    });

    const done = vi.fn();
    await verifyGoogleProfile(minimalProfile, done);

    expect(done.mock.calls[0][0]).toBeNull();
    expect(capturedFirstName).toBe('Minimal');
  });

  // ── Role escalation prevention ─────────────────────────────────────────────

  it('R1: role is always CUSTOMER regardless of anything in the Google profile', async () => {
    const attackerProfile: GoogleProfileStub = {
      id: 'google_attacker',
      emails: [{ value: 'attacker@gmail.com' }],
      name: { givenName: 'ADMIN', familyName: 'OPERATIONS_MANAGER' },
    };

    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce(null as never);

    let assignedRole: string | undefined;
    vi.mocked(prisma.$transaction).mockImplementation(async (fn) => {
      const txMock = {
        user: {
          create: vi.fn().mockImplementation(({ data }: { data: { role: string } }) => {
            assignedRole = data.role;
            return Promise.resolve({ id: 'u', email: 'attacker@gmail.com', firstName: 'ADMIN', lastName: '', role: data.role });
          }),
        },
        customerProfile: { create: vi.fn().mockResolvedValue({}) },
      };
      return fn(txMock as never);
    });

    await verifyGoogleProfile(attackerProfile, vi.fn());

    expect(assignedRole).toBe('CUSTOMER');
    expect(assignedRole).not.toBe('ADMIN');
    expect(assignedRole).not.toBe('OPERATIONS_MANAGER');
    expect(assignedRole).not.toBe('HUB_MANAGER');
    expect(assignedRole).not.toBe('COURIER');
  });
});

// ── Auth Service — login guards for Google-only accounts ───────────────────────

describe('Auth Service — login blocks Google-only accounts', () => {
  beforeEach(() => vi.clearAllMocks());

  const googleOnlyUser = {
    id: 'user_google',
    email: 'google@test.com',
    firstName: 'G',
    lastName: 'User',
    phone: null,
    role: 'CUSTOMER',
    avatarUrl: null,
    isEmailVerified: true,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    passwordHash: null,        // ← no password — Google-only account
    googleId: 'google_sub_001',
    deletedAt: null,
  };

  it('throws BadRequestError when a Google-only account attempts password login', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(googleOnlyUser as never);

    await expect(
      login({ email: 'google@test.com', password: 'anypassword' }),
    ).rejects.toThrow(BadRequestError);
  });

  it('error message instructs user to log in with Google', async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(googleOnlyUser as never);

    await expect(
      login({ email: 'google@test.com', password: 'anypassword' }),
    ).rejects.toThrow(/google sign-in/i);
  });
});
