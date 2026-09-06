import { describe, it, expect } from 'vitest';
import {
  hashPassword, verifyPassword, hashToken, verifyToken,
} from '../../app/lib/argon2';

// Argon2 is intentionally slow — timeout set to 30s per test
describe('Argon2 Library', { timeout: 30000 }, () => {
  it('hashes and verifies a password correctly', async () => {
    const hash = await hashPassword('SecurePassword123!');
    expect(hash).toContain('$argon2id$');
    expect(await verifyPassword(hash, 'SecurePassword123!')).toBe(true);
  });

  it('returns false for wrong password', async () => {
    const hash = await hashPassword('CorrectPassword');
    expect(await verifyPassword(hash, 'WrongPassword')).toBe(false);
  });

  it('generates different hashes for same password (salt randomness)', async () => {
    const h1 = await hashPassword('same_password');
    const h2 = await hashPassword('same_password');
    expect(h1).not.toBe(h2);
  });

  it('hashes and verifies a refresh token', async () => {
    const raw = 'a'.repeat(128);
    const hash = await hashToken(raw);
    expect(hash).toContain('$argon2id$');
    expect(await verifyToken(hash, raw)).toBe(true);
  });

  it('returns false for wrong token', async () => {
    const hash = await hashToken('correct_token');
    expect(await verifyToken(hash, 'wrong_token')).toBe(false);
  });

  it('returns false on invalid hash (does not throw)', async () => {
    expect(await verifyPassword('not-a-valid-hash', 'anything')).toBe(false);
  });
});
