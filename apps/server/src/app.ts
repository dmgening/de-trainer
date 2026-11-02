import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { secureHeaders } from 'hono/secure-headers';
import { ROUTES } from '@de-trainer/core';
import type { AccessVerifier } from './auth/access';
import type { DevAuth } from './auth/dev-auth';
import { ACCESS_COOKIE } from './auth/middleware';
import { createContentService, type ContentService } from './content/service';
import { DEV_USER_AUDIENCE, DEV_USER_EMAIL, type Config } from './config';
import type { Db } from './db/client';
import { apiError } from './errors';
import { createLearnerService } from './learner/service';
import type { Logger } from './logger';
import { agentRoutes } from './routes/agent';
import { ownerRoutes } from './routes/owner';
import { serveDir } from './static';
import type { AppEnv } from './types';

export type AppDeps = {
  config: Config;
  db: Db;
  verify: AccessVerifier;
  logger: Logger;
  /** Present outside prod only: enables /auth/dev-login and the cookie fallback. */
  devAuth?: DevAuth;
  content?: ContentService;
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
        // blob: — offline media are read from Cache Storage and shown through object URLs.
        imgSrc: ["'self'", 'data:', 'blob:'],
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
    app.get(`${ROUTES.auth}/dev-logout`, (c) => {
      deleteCookie(c, ACCESS_COOKIE, { path: '/' });
      return c.redirect(ROUTES.demo);
    });
  }

  const allowCookie = devAuth !== undefined;
  const content = deps.content ?? createContentService(db, config.dataDir);
  const learner = createLearnerService(db);

  app.route(
    ROUTES.api,
    ownerRoutes({
      db,
      verify,
      audiences: config.access.userAudiences,
      allowCookie,
      content,
      learner,
      logoutUrl: devAuth ? `${ROUTES.auth}/dev-logout` : '/cdn-cgi/access/logout',
    }),
  );
  app.route(ROUTES.agent, agentRoutes({ db, verify, audiences: config.access.agentAudiences, content, learner }));

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
