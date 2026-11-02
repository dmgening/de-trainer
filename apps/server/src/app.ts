import { Hono } from 'hono';
import { setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { ROUTES, SCHEMA_VERSION, type AgentWhoamiResponse, type MeResponse } from '@de-trainer/core';
import type { AccessVerifier } from './auth/access';
import type { DevAuth } from './auth/dev-auth';
import { ACCESS_COOKIE, agentAuth, userAuth } from './auth/middleware';
import { DEV_USER_AUDIENCE, DEV_USER_EMAIL, type Config } from './config';
import type { Db } from './db/client';
import { listUserBanks } from './db/repo';
import { apiError } from './errors';
import type { Logger } from './logger';
import { serveDir } from './static';
import type { AgentEnv, AppEnv, UserEnv } from './types';

export type AppDeps = {
  config: Config;
  db: Db;
  verify: AccessVerifier;
  logger: Logger;
  /** Present outside prod only: enables /auth/dev-login and the cookie fallback. */
  devAuth?: DevAuth;
};

const RESERVED = [ROUTES.api, ROUTES.auth, '/agent'];

export function createApp(deps: AppDeps) {
  const { config, db, verify, logger, devAuth } = deps;
  const app = new Hono<AppEnv>();

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    // Path only: no query strings, bodies or tokens in logs.
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        ms: Math.round(performance.now() - started),
        user_id: c.get('user')?.userId,
        agent_id: c.get('agent')?.agentId,
      },
      'request',
    );
  });

  app.use(
    '*',
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  app.get(ROUTES.health, (c) => c.text('ok'));

  // Cloudflare Access guards /auth: reaching this handler means the user has signed in.
  app.get(`${ROUTES.auth}/login`, (c) => c.redirect(devAuth ? `${ROUTES.auth}/dev-login` : '/'));
  if (devAuth) {
    app.get(`${ROUTES.auth}/dev-login`, async (c) => {
      const token = await devAuth.mint({ email: c.req.query('email') ?? DEV_USER_EMAIL }, DEV_USER_AUDIENCE);
      setCookie(c, ACCESS_COOKIE, token, { httpOnly: true, sameSite: 'Lax', path: '/' });
      return c.redirect('/');
    });
  }

  const allowCookie = devAuth !== undefined;

  const api = new Hono<UserEnv>();
  api.use('*', userAuth({ db, verify, audiences: config.access.userAudiences, allowCookie }));
  api.get('/me', (c) => {
    const user = c.get('user');
    const body: MeResponse = {
      user_id: user.userId,
      email: user.email,
      display_name: user.displayName,
      banks: listUserBanks(db, user.userId).map((b) => ({ bank_id: b.bankId, title: b.title, role: b.role })),
      schema_version: SCHEMA_VERSION,
    };
    return c.json(body);
  });
  api.all('*', (c) => apiError(c, 404, 'not_found', 'Unknown API route'));
  app.route(ROUTES.api, api);

  const agent = new Hono<AgentEnv>();
  agent.use('*', agentAuth({ db, verify, audiences: config.access.agentAudiences, allowCookie: false }));
  agent.get('/whoami', (c) => {
    const a = c.get('agent');
    const body: AgentWhoamiResponse = {
      agent_id: a.agentId,
      name: a.name,
      grants: a.grants.map((g) => ({ scope_type: g.scopeType, scope_id: g.scopeId, permission: g.permission })),
    };
    return c.json(body);
  });
  agent.all('*', (c) => apiError(c, 404, 'not_found', 'Unknown agent API route'));
  app.route(ROUTES.agent, agent);

  // Demo and owner builds share the origin; the server keeps their files and fallbacks apart.
  app.get('/demo', (c) => c.redirect(ROUTES.demo));
  app.get(`${ROUTES.demo}*`, serveDir(config.staticDemoDir, ROUTES.demo));

  const owner = serveDir(config.staticOwnerDir, '/');
  app.get('*', (c, next) => {
    if (RESERVED.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`))) {
      return apiError(c, 404, 'not_found', 'Unknown route');
    }
    return owner(c, next);
  });
  app.all('*', (c) => apiError(c, 404, 'not_found', 'Unknown route'));

  return app;
}
