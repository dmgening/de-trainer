import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, importJWK, SignJWT, type JWK, type JWTPayload } from 'jose';
import { DEV_ISSUER } from '../config';
import { createVerifier, type AccessVerifier } from './access';

const KID = 'dev';

/**
 * Local stand-in for Cloudflare Access outside prod: a key pair under DATA_DIR
 * signs tokens shaped like Access JWTs and verifies them.
 */
export type DevAuth = {
  verify: AccessVerifier;
  mint: (claims: JWTPayload, audience: string) => Promise<string>;
};

type KeyFile = { privateJwk: JWK; publicJwk: JWK };

async function readOrCreateKeys(file: string): Promise<KeyFile> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as KeyFile;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const keys = { privateJwk: await exportJWK(privateKey), publicJwk: await exportJWK(publicKey) };
    await writeFile(file, JSON.stringify(keys), { mode: 0o600 });
    return keys;
  }
}

export async function loadDevAuth(dataDir: string): Promise<DevAuth> {
  const keys = await readOrCreateKeys(path.join(dataDir, 'dev-jwk.json'));
  const privateKey = await importJWK(keys.privateJwk, 'RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...keys.publicJwk, kid: KID, alg: 'RS256' }] });
  return {
    verify: createVerifier(jwks, DEV_ISSUER),
    mint: (claims, audience) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', kid: KID })
        .setIssuer(DEV_ISSUER)
        .setAudience(audience)
        .setIssuedAt()
        .setExpirationTime('30d')
        .sign(privateKey),
  };
}
