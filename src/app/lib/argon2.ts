import argon2 from 'argon2';

// OWASP 2024 recommended Argon2id parameters for passwords
const PASSWORD_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 65536, // 64 MB
  timeCost: 3,
  parallelism: 4,
};

// Lighter parameters for opaque token hashing (refresh tokens)
// Still one-way, but fast since tokens are 128-char random strings
const TOKEN_OPTIONS: argon2.Options & { raw?: false } = {
  type: argon2.argon2id,
  memoryCost: 4096, // 4 MB
  timeCost: 1,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, PASSWORD_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export async function hashToken(token: string): Promise<string> {
  return argon2.hash(token, TOKEN_OPTIONS);
}

export async function verifyToken(hash: string, token: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, token);
  } catch {
    return false;
  }
}
