import { createHash, randomBytes } from 'node:crypto';

/** Recognisable in configs and secret scanners; the rest is 256 random bits. */
export const AGENT_TOKEN_PREFIX = 'dct_';
const TOKEN = /^dct_[A-Za-z0-9_-]{43}$/;

/**
 * The server keeps only the hash. A plain SHA-256 is enough: the token is random, not a password,
 * so there is nothing to brute-force and the lookup by hash stays a single indexed query.
 */
export const hashAgentToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function newAgentToken() {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  return { token, hash: hashAgentToken(token) };
}

/** `Authorization: Bearer dct_…` → the token; anything else → undefined. */
export function bearerToken(header: string | undefined) {
  const m = header?.match(/^Bearer\s+(\S+)\s*$/i);
  return m && TOKEN.test(m[1]!) ? m[1] : undefined;
}
