import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { pino } from 'pino';
import { ContentPackage, uuidv7, type ClientEvent, type ContentPackageInput, type Permission } from '@de-trainer/core';
import { FIXTURE_MEDIA, ownerPackage } from '@de-trainer/fixtures';
import { readMedia } from '@de-trainer/fixtures/node';
import { createApp } from '../src/app';
import { createVerifier } from '../src/auth/access';
import { loadConfig, type Config } from '../src/config';
import { openDb, runMigrations } from '../src/db/client';
import { addAgent, addBankMember, addUser, grantAgent, upsertBank } from '../src/db/repo';

export const ISSUER = 'https://test-team.cloudflareaccess.com';
export const USER_AUD = 'aud-user';
export const AGENT_AUD = 'aud-agent';
const ALL_USER_PERMS: Permission[] = ['events:read', 'events:write', 'recommendations:write', 'scheduler:write'];

/**
 * A real server in process: real SQLite (in memory), real data directory, real JWT checks.
 * Two learners (alice owns bank "dev", bob owns "bob") and Nomir with grants on alice only.
 */
export async function createTestServer() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });
  const sign = (claims: JWTPayload, aud: string) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(ISSUER).setAudience(aud).setIssuedAt().setExpirationTime('5m').sign(privateKey);

  const dataDir = mkdtempSync(path.join(tmpdir(), 'de-trainer-data-'));
  const config: Config = {
    ...loadConfig({ APP_ENV: 'test', LOG_LEVEL: 'silent' }),
    dataDir,
    staticOwnerDir: path.join(dataDir, 'no-owner'),
    staticDemoDir: path.join(dataDir, 'no-demo'),
    access: { mode: 'cloudflare', teamDomain: ISSUER, userAudiences: [USER_AUD], agentAudiences: [AGENT_AUD] },
  };
  const { db } = openDb(':memory:');
  runMigrations(db, config.migrationsDir);
  upsertBank(db, { bankId: 'dev', title: 'Dev', audience: 'owner' });
  upsertBank(db, { bankId: 'bob', title: 'Bob', audience: 'owner' });
  const alice = addUser(db, { email: 'alice@example.com', displayName: 'Alice' });
  const bob = addUser(db, { email: 'bob@example.com', displayName: 'Bob' });
  addBankMember(db, 'dev', alice.userId, 'owner');
  addBankMember(db, 'bob', bob.userId, 'owner');
  const nomir = addAgent(db, { name: 'nomir', accessClientId: 'nomir.access' });
  grantAgent(db, nomir.agentId, 'user', alice.userId, ALL_USER_PERMS);
  grantAgent(db, nomir.agentId, 'bank', 'dev', ['bank:publish']);

  const app = createApp({ config, db, verify: createVerifier(jwks, ISSUER), logger: pino({ level: 'silent' }) });

  const tokens = {
    alice: await sign({ email: 'alice@example.com' }, USER_AUD),
    bob: await sign({ email: 'bob@example.com' }, USER_AUD),
    nomir: await sign({ common_name: 'nomir.access' }, AGENT_AUD),
  };
  type Who = keyof typeof tokens;
  const call = (who: Who | null, method: string, url: string, body?: unknown, raw?: RequestInit['body']) =>
    app.request(url, {
      method,
      headers: {
        ...(who ? { 'Cf-Access-Jwt-Assertion': tokens[who] } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });

  const json = async <T = any>(res: Response | Promise<Response>): Promise<{ status: number; body: T }> => {
    const r = await res;
    return { status: r.status, body: (await r.json()) as T };
  };

  const uploadFixtureMedia = () => {
    const m = FIXTURE_MEDIA.room;
    return call('nomir', 'PUT', `/agent/v1/banks/dev/media/${m.sha256}`, undefined, readMedia(m.file));
  };

  return { app, db, dataDir, alice, bob, call, json, uploadFixtureMedia, sign };
}

export type TestServer = Awaited<ReturnType<typeof createTestServer>>;

export const devPackage = (over: Partial<ContentPackageInput> = {}) => ({ ...ContentPackage.parse(ownerPackage('dev')), ...over });

export function attemptEvent(userId: string, o: { exercise: string; skill: string; result: 'correct' | 'wrong'; session?: string; ts?: string; device?: string; revision?: number }): ClientEvent {
  const id = uuidv7();
  const ts = o.ts ?? new Date().toISOString();
  return {
    event_id: id,
    user_id: userId,
    device_id: o.device ?? 'device-a',
    client_ts: ts,
    type: 'attempt',
    payload: {
      attempt_id: id,
      session_id: o.session ?? uuidv7(),
      mode: 'recommended',
      bank_id: 'dev',
      bank_version: 1,
      exercise_id: o.exercise,
      exercise_revision: o.revision ?? 1,
      family_id: 'f',
      topic_ids: ['wohnung'],
      primary_skill_id: o.skill,
      knowledge_item_ids: [],
      started_at: ts,
      answered_at: ts,
      duration_ms: 1200,
      local_date: ts.slice(0, 10),
      response: { type: 'choice', option_id: o.result === 'correct' ? 'a' : 'b' },
      result: o.result,
      hints_used: 0,
      retry: false,
      checker_version: 1,
      scheduler_version: 1,
    },
  };
}
