import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const csv = z
  .string()
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const Env = z.object({
  APP_ENV: z.enum(['dev', 'test', 'prod']).default('dev'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(8080),
  DATA_DIR: z.string().optional(),
  STATIC_OWNER_DIR: z.string().optional(),
  STATIC_DEMO_DIR: z.string().optional(),
  ACCESS_TEAM_DOMAIN: z.string().optional(),
  ACCESS_AUD_USER: csv.optional(),
  ACCESS_AUD_AGENT: csv.optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type AccessConfig =
  | { mode: 'cloudflare'; teamDomain: string; userAudiences: string[]; agentAudiences: string[] }
  | { mode: 'dev'; issuer: string; userAudiences: string[]; agentAudiences: string[] };

export type Config = {
  env: 'dev' | 'test' | 'prod';
  host: string;
  port: number;
  dataDir: string;
  databasePath: string;
  migrationsDir: string;
  staticOwnerDir: string;
  staticDemoDir: string;
  access: AccessConfig;
  logLevel: z.infer<typeof Env>['LOG_LEVEL'];
};

export const DEV_ISSUER = 'https://dev.de-class.local';
export const DEV_USER_AUDIENCE = 'dev-user';
export const DEV_AGENT_AUDIENCE = 'dev-agent';
export const DEV_USER_EMAIL = 'dev@local.test';
export const DEV_AGENT_CLIENT_ID = 'dev-agent.access';

// apps/server/ — the same from src/ (tsx) and dist/ (bundled), so defaults work in both.
const serverRoot = fileURLToPath(new URL('../', import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const e = Env.parse(env);
  const dataDir = path.resolve(e.DATA_DIR ?? path.join(serverRoot, '.data'));

  let access: AccessConfig;
  if (e.APP_ENV === 'prod') {
    if (!e.DATA_DIR) throw new Error('DATA_DIR is required in prod');
    const team = e.ACCESS_TEAM_DOMAIN?.replace(/\/+$/, '');
    if (!team || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(team)) {
      throw new Error('ACCESS_TEAM_DOMAIN must be https://<team>.cloudflareaccess.com in prod');
    }
    if (!e.ACCESS_AUD_USER?.length || !e.ACCESS_AUD_AGENT?.length) {
      throw new Error('ACCESS_AUD_USER and ACCESS_AUD_AGENT are required in prod');
    }
    access = {
      mode: 'cloudflare',
      teamDomain: team,
      userAudiences: e.ACCESS_AUD_USER,
      agentAudiences: e.ACCESS_AUD_AGENT,
    };
  } else {
    access = {
      mode: 'dev',
      issuer: DEV_ISSUER,
      userAudiences: [DEV_USER_AUDIENCE],
      agentAudiences: [DEV_AGENT_AUDIENCE],
    };
  }

  return {
    env: e.APP_ENV,
    host: e.HOST,
    port: e.PORT,
    dataDir,
    databasePath: path.join(dataDir, 'app.sqlite'),
    migrationsDir: path.join(serverRoot, 'drizzle'),
    staticOwnerDir: path.resolve(e.STATIC_OWNER_DIR ?? path.join(serverRoot, '../web/dist/owner')),
    staticDemoDir: path.resolve(e.STATIC_DEMO_DIR ?? path.join(serverRoot, '../web/dist/demo')),
    access,
    logLevel: e.LOG_LEVEL,
  };
}
