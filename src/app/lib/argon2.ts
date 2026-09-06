import { hash, verify, argon2id } from 'argon2';

// OWASP 2024 recommended Argon2id parameters for passwords
const PASSWORD_OPTIONS = {
  type: argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
} as const;

// Lighter parameters for opaque token hashing (refresh tokens)
const TOKEN_OPTIONS = {
  type: argon2id,
  memoryCost: 4096, // 4 MB
  timeCost: 1,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return hash(password, PASSWORD_OPTIONS);
}

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false;
  }
}

export async function hashToken(token: string): Promise<string> {
  return hash(token, TOKEN_OPTIONS);
}

export async function verifyToken(storedHash: string, token: string): Promise<boolean> {
  try {
    return await verify(storedHash, token);
  } catch {
    return false;
  }
}
