import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { AuthenticationError } from '../errors';
import type { JwtPayload } from '../types';

export function signAccessToken(payload: { sub: string; role: string }): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export function verifyAccessToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new AuthenticationError('Access token has expired. Please refresh your token.');
    }
    throw new AuthenticationError('Invalid access token.');
  }
}

/**
 * Generates a cryptographically secure opaque refresh token.
 * This is NOT a JWT — it is a random hex string stored hashed in the DB.
 */
export function generateRefreshToken(): string {
  return randomBytes(64).toString('hex');
}
