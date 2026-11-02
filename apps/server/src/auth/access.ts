import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';

/** Verifies a Cloudflare Access JWT for one of the given Access application audiences. */
export type AccessVerifier = (token: string, audiences: string[]) => Promise<JWTPayload>;

export function createVerifier(getKey: JWTVerifyGetKey, issuer: string): AccessVerifier {
  return async (token, audiences) => {
    const { payload } = await jwtVerify(token, getKey, { issuer, audience: audiences, algorithms: ['RS256'] });
    return payload;
  };
}

export function cloudflareVerifier(teamDomain: string): AccessVerifier {
  return createVerifier(createRemoteJWKSet(new URL('/cdn-cgi/access/certs', teamDomain)), teamDomain);
}
