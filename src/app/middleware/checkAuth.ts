import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticationError, AuthorizationError } from '../errors';
import { verifyAccessToken } from '../lib/jwt';
import type { Role } from '../types';

/**
 * authenticate — verifies JWT, loads req.user from DB.
 * Always checks deletedAt and isActive — a deactivated user cannot pass this middleware.
 * For HUB_MANAGER: also fetches hubId from HubManagerProfile (never trusted from JWT).
 */
export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    // Accept token from Authorization header (Bearer) or cookie
    const raw =
      req.cookies?.accessToken ??
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : req.headers.authorization);

    if (!raw) {
      throw new AuthenticationError('No access token provided. Please log in.');
    }

    const payload = verifyAccessToken(raw);

    // DB check on every request — ensures deactivated/deleted users are rejected
    // even within the 15-minute access token window
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        deletedAt: true,
        hubManagerProfile: {
          select: { hubId: true },
        },
      },
    });

    if (!user) {
      throw new AuthenticationError('User not found. Please log in again.');
    }

    if (user.deletedAt !== null) {
      throw new AuthenticationError('This account has been deactivated.');
    }

    if (!user.isActive) {
      throw new AuthenticationError('This account has been suspended. Please contact support.');
    }

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      // hubId is DB-fetched — cannot be spoofed via JWT manipulation
      hubId: user.hubManagerProfile?.hubId ?? null,
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * authorize — RBAC middleware factory.
 * Must be used AFTER authenticate.
 * Usage: authorize('ADMIN', 'OPS_MANAGER')
 */
export const authorize = (...allowedRoles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required.'));
    }

    if (!allowedRoles.includes(req.user.role as Role)) {
      return next(
        new AuthorizationError(
          `Access denied. Required role: ${allowedRoles.join(' or ')}.`,
        ),
      );
    }

    next();
  };
};
