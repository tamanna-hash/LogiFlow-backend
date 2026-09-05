export * from './enums';

// ── Shared DTO types ─────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;   // userId
  role: string;  // Role enum value
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthenticatedUser {
  id: string;
  role: string;
  email: string;
  firstName: string;
  lastName: string;
  hubId?: string | null;
}

// Safe user select — never includes passwordHash
export const safeUserSelect = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  role: true,
  avatarUrl: true,
  isEmailVerified: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;
