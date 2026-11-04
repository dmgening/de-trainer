import type { Context, MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Db } from '../db/client';
import { findActiveAgentByClientId, findActiveAgentByTokenHash, findActiveUserByEmail, listAgentGrants } from '../db/repo';
import { apiError } from '../errors';
import type { AgentEnv, UserEnv } from '../types';
import type { AccessVerifier } from './access';
import { bearerToken, hashAgentToken } from './agent-token';

export const ACCESS_JWT_HEADER = 'cf-access-jwt-assertion';
export const ACCESS_COOKIE = 'CF_Authorization';

type AuthDeps = {
  db: Db;
  verify: AccessVerifier;
  audiences: string[];
  /** Dev only: read the token from the cookie set by /auth/dev-login. In prod Access always sends the header. */
  allowCookie: boolean;
};

async function verifiedClaims(c: Context, deps: AuthDeps) {
  const token = c.req.header(ACCESS_JWT_HEADER) ?? (deps.allowCookie ? getCookie(c, ACCESS_COOKIE) : undefined);
  if (!token) return undefined;
  try {
    return await deps.verify(token, deps.audiences);
  } catch {
    return undefined;
  }
}

/** Second lock after the Access policy: the email must belong to an active user in our table. */
export function userAuth(deps: AuthDeps): MiddlewareHandler<UserEnv> {
  return async (c, next) => {
    const claims = await verifiedClaims(c, deps);
    if (!claims) return apiError(c, 401, 'unauthenticated', 'Cloudflare Access sign-in required');
    // Service tokens carry common_name instead of an email and never act as a user.
    const email = typeof claims.email === 'string' && claims.common_name === undefined ? claims.email : undefined;
    const user = email ? findActiveUserByEmail(deps.db, email) : undefined;
    if (!user) return apiError(c, 403, 'forbidden', 'This account has no access');
    c.set('user', { userId: user.userId, email: user.email, displayName: user.displayName });
    await next();
  };
}

/**
 * Agents authenticate one of two ways. An API token (`Authorization: Bearer dct_…`) works without
 * Cloudflare, e.g. from the LAN; when the header is present it is the only identity considered.
 * Otherwise an Access service token, whose Client ID arrives as common_name.
 */
export function agentAuth(deps: AuthDeps): MiddlewareHandler<AgentEnv> {
  return async (c, next) => {
    let agent;
    const authorization = c.req.header('authorization');
    if (authorization !== undefined) {
      // Cloudflare stamps every request it proxies with CF-Ray and a client cannot strip it, so this
      // keeps the token a LAN-only way in even if /agent is ever routed through the tunnel without Access.
      if (c.req.header('cf-ray') !== undefined) {
        return apiError(c, 403, 'forbidden', 'API tokens are not accepted through Cloudflare');
      }
      const token = bearerToken(authorization);
      agent = token ? findActiveAgentByTokenHash(deps.db, hashAgentToken(token)) : undefined;
      if (!agent) return apiError(c, 401, 'unauthenticated', 'Invalid or revoked API token');
    } else {
      const claims = deps.audiences.length ? await verifiedClaims(c, deps) : undefined;
      if (!claims) return apiError(c, 401, 'unauthenticated', 'API token or Access service token required');
      const clientId = typeof claims.common_name === 'string' ? claims.common_name : undefined;
      agent = clientId ? findActiveAgentByClientId(deps.db, clientId) : undefined;
      if (!agent) return apiError(c, 403, 'forbidden', 'This service token has no access');
    }
    c.set('agent', { agentId: agent.agentId, name: agent.name, grants: listAgentGrants(deps.db, agent.agentId) });
    await next();
  };
}
