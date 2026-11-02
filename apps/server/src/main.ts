import { mkdirSync } from 'node:fs';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { cloudflareVerifier, type AccessVerifier } from './auth/access';
import { loadDevAuth, type DevAuth } from './auth/dev-auth';
import { loadConfig } from './config';
import { openDb } from './db/client';
import { createLogger } from './logger';

const config = loadConfig();
const logger = createLogger(config.logLevel);
mkdirSync(config.dataDir, { recursive: true });
const { db, sqlite } = openDb(config.databasePath);

let verify: AccessVerifier;
let devAuth: DevAuth | undefined;
if (config.access.mode === 'cloudflare') {
  verify = cloudflareVerifier(config.access.teamDomain);
} else {
  devAuth = await loadDevAuth(config.dataDir);
  verify = devAuth.verify;
}

const app = createApp({ config, db, verify, logger, devAuth });
const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
  logger.info({ env: config.env, host: config.host, port: info.port, access: config.access.mode }, 'listening');
});

const shutdown = () => {
  server.close(() => {
    sqlite.close();
    process.exit(0);
  });
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
