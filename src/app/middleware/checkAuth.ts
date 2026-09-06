import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import { AuthenticationError, AuthorizationError } from '../errors';
import { verifyAccessToken } from '../lib/jwt';
import type { Role } from '@prisma/client';

/**
 * authenticate — verifies JWT, loads req.user from DB.
 * Checks deletedAt and isActive on every request.
 * For HUB_MANAGER: fetches hubId from DB — never from JWT.
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const raw =
      req.cookies?.accessToken ??
      (req.headers.authorization?.startsWith('Bearer ')
        ? req.headers.authorization.split(' ')[1]
        : req.headers.authorization);

    if (!raw) {
      throw new AuthenticationError('No access token provided. Please log in.');
    }

    const payload = verifyAccessToken(raw);

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
        hubManagerProfile: { select: { hubId: true } },
      },
    });

    if (!user) throw new AuthenticationError('User not found. Please log in again.');
    if (user.deletedAt !== null) throw new AuthenticationError('This account has been deactivated.');
    if (!user.isActive) throw new AuthenticationError('This account has been suspended.');

    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      hubId: user.hubManagerProfile?.hubId ?? null,
    };

    next();
  } catch (err) {
    next(err);
  }
};

/**
 * authorize — RBAC middleware factory. Must be used after authenticate.
 */
export const authorize = (...allowedRoles: Role[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(new AuthenticationError('Authentication required.'));
    if (!allowedRoles.includes(req.user.role as Role)) {
      return next(new AuthorizationError(`Access denied. Required role: ${allowedRoles.join(' or ')}.`));
    }
    next();
  };
};
