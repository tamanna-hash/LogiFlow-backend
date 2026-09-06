import { describe, it, expect } from 'vitest';
import { signAccessToken, verifyAccessToken, generateRefreshToken } from '../../app/lib/jwt';
import { AuthenticationError } from '../../app/errors';

describe('JWT Library', () => {
  it('signs and verifies a valid access token', () => {
    const payload = { sub: 'user_01', role: 'CUSTOMER' };
    const token = signAccessToken(payload);

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const decoded = verifyAccessToken(token);
    expect(decoded.sub).toBe('user_01');
    expect(decoded.role).toBe('CUSTOMER');
  });

  it('throws AuthenticationError for invalid token', () => {
    expect(() => verifyAccessToken('invalid.token.here')).toThrow(AuthenticationError);
  });

  it('throws AuthenticationError for tampered token', () => {
    const token = signAccessToken({ sub: 'user_01', role: 'CUSTOMER' });
    const tampered = token.slice(0, -5) + 'xxxxx';
    expect(() => verifyAccessToken(tampered)).toThrow(AuthenticationError);
  });

  it('generates a 128-character hex refresh token', () => {
    const token = generateRefreshToken();
    expect(typeof token).toBe('string');
    expect(token).toHaveLength(128);
    expect(/^[0-9a-f]+$/.test(token)).toBe(true);
  });

  it('generates unique tokens on each call', () => {
    const t1 = generateRefreshToken();
    const t2 = generateRefreshToken();
    expect(t1).not.toBe(t2);
  });
});
