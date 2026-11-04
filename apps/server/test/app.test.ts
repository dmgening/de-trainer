import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTPayload } from 'jose';
import { pino } from 'pino';
import { beforeAll, describe, expect, it } from 'vitest';
import { AgentWhoamiResponse, MeResponse } from '@de-trainer/core';
import { createApp } from '../src/app';
import { createVerifier } from '../src/auth/access';
import { newAgentToken } from '../src/auth/agent-token';
import { loadConfig, type Config } from '../src/config';
import { openDb, runMigrations } from '../src/db/client';
import {
  addAgent,
  addBankMember,
  addUser,
  grantAgent,
  setAgentStatus,
  setAgentTokenHash,
  setUserStatus,
  upsertBank,
} from '../src/db/repo';

const ISSUER = 'https://test-team.cloudflareaccess.com';
const USER_AUD = 'aud-user';
const AGENT_AUD = 'aud-agent';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
type Signer = (claims: JWTPayload, opts?: { aud?: string; exp?: string; key?: PrivateKey }) => Promise<string>;

async function setup() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const other = await generateKeyPair('RS256');
  const jwks = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' }] });

  const sign: Signer = (claims, opts = {}) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(ISSUER)
      .setAudience(opts.aud ?? USER_AUD)
      .setIssuedAt()
      .setExpirationTime(opts.exp ?? '5m')
      .sign(opts.key ?? privateKey);

  const staticRoot = mkdtempSync(path.join(tmpdir(), 'de-trainer-static-'));
  const ownerDir = path.join(staticRoot, 'owner');
  const demoDir = path.join(staticRoot, 'demo');
  mkdirSync(path.join(ownerDir, 'assets'), { recursive: true });
  mkdirSync(demoDir, { recursive: true });
  writeFileSync(path.join(ownerDir, 'index.html'), '<p>owner</p>');
  writeFileSync(path.join(ownerDir, 'assets', 'app-abc123.js'), 'console.log(1)');
  writeFileSync(path.join(ownerDir, 'sw.js'), '// sw');
  writeFileSync(path.join(demoDir, 'index.html'), '<p>demo</p>');
  writeFileSync(path.join(staticRoot, 'secret.txt'), 'outside');

  const base = loadConfig({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
  const config: Config = {
    ...base,
    staticOwnerDir: ownerDir,
    staticDemoDir: demoDir,
    access: { mode: 'cloudflare', teamDomain: ISSUER, userAudiences: [USER_AUD], agentAudiences: [AGENT_AUD] },
  };

  const { db } = openDb(':memory:');
  runMigrations(db, config.migrationsDir);

  upsertBank(db, { bankId: 'bank-a', title: 'Bank A', audience: 'owner' });
  upsertBank(db, { bankId: 'bank-b', title: 'Bank B', audience: 'owner' });
  const alice = addUser(db, { email: 'Alice@Example.com', displayName: 'Alice' });
  const bob = addUser(db, { email: 'bob@example.com', displayName: 'Bob' });
  addUser(db, { email: 'off@example.com', displayName: 'Off' });
  setUserStatus(db, 'off@example.com', 'disabled');
  addBankMember(db, 'bank-a', alice.userId);
  addBankMember(db, 'bank-b', bob.userId);

  const nomir = addAgent(db, { name: 'nomir', accessClientId: 'nomir.access' });
  grantAgent(db, nomir.agentId, 'user', alice.userId, ['events:read']);
  grantAgent(db, nomir.agentId, 'bank', 'bank-a', ['bank:publish']);
  addAgent(db, { name: 'old', accessClientId: 'old.access' });
  const oldToken = newAgentToken();
  setAgentTokenHash(db, 'old', oldToken.hash);
  setAgentStatus(db, 'old', 'revoked');

  const app = createApp({
    config,
    db,
    verify: createVerifier(jwks, ISSUER),
    logger: pino({ level: 'silent' }),
  });
  // The same server once the agent Access application is gone (ACCESS_AUD_AGENT unset).
  const tokenOnlyApp = createApp({
    config: { ...config, access: { ...config.access, agentAudiences: [] } },
    db,
    verify: createVerifier(jwks, ISSUER),
    logger: pino({ level: 'silent' }),
  });

  const get = (url: string, token?: string) =>
    app.request(url, { headers: token ? { 'Cf-Access-Jwt-Assertion': token } : {} });

  const issueToken = (name: string) => {
    const { token, hash } = newAgentToken();
    setAgentTokenHash(db, name, hash);
    return token;
  };
  const withHeaders = (url: string, headers: Record<string, string>) => app.request(url, { headers });

  return { get, withHeaders, tokenOnlyApp, issueToken, db, revokedAgentToken: oldToken.token, sign, otherKey: other.privateKey, alice, bob };
}

let t: Awaited<ReturnType<typeof setup>>;
beforeAll(async () => {
  t = await setup();
});

describe('health and headers', () => {
  it('answers /healthz without auth', async () => {
    const res = await t.get('/healthz');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('sends a strict CSP', async () => {
    const res = await t.get('/healthz');
    expect(res.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
  });
});

describe('/api — user auth', () => {
  it('rejects a request without the Access header', async () => {
    expect((await t.get('/api/me')).status).toBe(401);
  });

  it('returns the signed-in user with only their banks', async () => {
    const res = await t.get('/api/me', await t.sign({ email: 'alice@example.com' }));
    expect(res.status).toBe(200);
    const me = MeResponse.parse(await res.json());
    expect(me.user_id).toBe(t.alice.userId);
    expect(me.banks.map((b) => b.bank_id)).toEqual(['bank-a']);
  });

  it('matches email case-insensitively', async () => {
    expect((await t.get('/api/me', await t.sign({ email: 'ALICE@example.com' }))).status).toBe(200);
  });

  it('keeps users apart (A18)', async () => {
    const res = await t.get('/api/me', await t.sign({ email: 'bob@example.com' }));
    const me = MeResponse.parse(await res.json());
    expect(me.user_id).toBe(t.bob.userId);
    expect(me.banks.map((b) => b.bank_id)).toEqual(['bank-b']);
  });

  it('rejects a token for another Access application', async () => {
    expect((await t.get('/api/me', await t.sign({ email: 'alice@example.com' }, { aud: AGENT_AUD }))).status).toBe(401);
  });

  it('rejects a token signed by an unknown key', async () => {
    const token = await t.sign({ email: 'alice@example.com' }, { key: t.otherKey });
    expect((await t.get('/api/me', token)).status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = await t.sign({ email: 'alice@example.com' }, { exp: '-1m' });
    expect((await t.get('/api/me', token)).status).toBe(401);
  });

  it('refuses a valid Access identity that is not in the users table', async () => {
    expect((await t.get('/api/me', await t.sign({ email: 'stranger@example.com' }))).status).toBe(403);
  });

  it('refuses a disabled user', async () => {
    expect((await t.get('/api/me', await t.sign({ email: 'off@example.com' }))).status).toBe(403);
  });

  it('never lets a service token act as a user', async () => {
    const token = await t.sign({ common_name: 'nomir.access', email: 'alice@example.com' });
    expect((await t.get('/api/me', token)).status).toBe(403);
  });

  it('authenticates before answering unknown API routes', async () => {
    expect((await t.get('/api/nope')).status).toBe(401);
    expect((await t.get('/api/nope', await t.sign({ email: 'alice@example.com' }))).status).toBe(404);
  });
});

describe('/agent/v1 — service token auth', () => {
  it('returns the agent and its grants', async () => {
    const res = await t.get('/agent/v1/whoami', await t.sign({ common_name: 'nomir.access' }, { aud: AGENT_AUD }));
    expect(res.status).toBe(200);
    const body = AgentWhoamiResponse.parse(await res.json());
    expect(body.name).toBe('nomir');
    expect(body.grants).toEqual(
      expect.arrayContaining([
        { scope_type: 'user', scope_id: t.alice.userId, permission: 'events:read' },
        { scope_type: 'bank', scope_id: 'bank-a', permission: 'bank:publish' },
      ]),
    );
  });

  it('rejects a user token', async () => {
    expect((await t.get('/agent/v1/whoami', await t.sign({ email: 'alice@example.com' }))).status).toBe(401);
    const sameAud = await t.sign({ email: 'alice@example.com' }, { aud: AGENT_AUD });
    expect((await t.get('/agent/v1/whoami', sameAud)).status).toBe(403);
  });

  it('rejects an unknown or revoked service token', async () => {
    expect((await t.get('/agent/v1/whoami', await t.sign({ common_name: 'x.access' }, { aud: AGENT_AUD }))).status).toBe(403);
    expect((await t.get('/agent/v1/whoami', await t.sign({ common_name: 'old.access' }, { aud: AGENT_AUD }))).status).toBe(403);
  });
});

describe('/agent/v1 — API token auth', () => {
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('authenticates the agent without Cloudflare', async () => {
    const res = await t.withHeaders('/agent/v1/whoami', bearer(t.issueToken('nomir')));
    expect(res.status).toBe(200);
    const body = AgentWhoamiResponse.parse(await res.json());
    expect(body.name).toBe('nomir');
    expect(body.grants).toContainEqual({ scope_type: 'user', scope_id: t.alice.userId, permission: 'events:read' });
  });

  it('keeps grant checks: a token reaches only granted users and banks', async () => {
    const headers = bearer(t.issueToken('nomir'));
    expect((await t.withHeaders(`/agent/v1/users/${t.bob.userId}/events`, headers)).status).toBe(403);
    expect((await t.withHeaders('/agent/v1/banks/bank-b', headers)).status).toBe(403);
  });

  it('invalidates the previous token when a new one is issued', async () => {
    const first = t.issueToken('nomir');
    const second = t.issueToken('nomir');
    expect((await t.withHeaders('/agent/v1/whoami', bearer(first))).status).toBe(401);
    expect((await t.withHeaders('/agent/v1/whoami', bearer(second))).status).toBe(200);
  });

  it('stops working once removed', async () => {
    const token = t.issueToken('nomir');
    setAgentTokenHash(t.db, 'nomir', null);
    expect((await t.withHeaders('/agent/v1/whoami', bearer(token))).status).toBe(401);
  });

  it('rejects unknown, malformed and revoked-agent tokens', async () => {
    t.issueToken('nomir');
    const unknown = newAgentToken().token;
    for (const authorization of [`Bearer ${unknown}`, 'Bearer nope', 'Basic bm9taXI6eA==', `Bearer ${t.revokedAgentToken}`]) {
      const res = await t.withHeaders('/agent/v1/whoami', { Authorization: authorization });
      expect(res.status, authorization).toBe(401);
    }
  });

  it('uses only the API token when both credentials are sent', async () => {
    const jwt = await t.sign({ common_name: 'nomir.access' }, { aud: AGENT_AUD });
    const res = await t.withHeaders('/agent/v1/whoami', { ...bearer(newAgentToken().token), 'Cf-Access-Jwt-Assertion': jwt });
    expect(res.status).toBe(401);
  });

  it('is the only way in when ACCESS_AUD_AGENT is unset', async () => {
    const jwt = await t.sign({ common_name: 'nomir.access' }, { aud: AGENT_AUD });
    const viaAccess = await t.tokenOnlyApp.request('/agent/v1/whoami', { headers: { 'Cf-Access-Jwt-Assertion': jwt } });
    expect(viaAccess.status).toBe(401);
    const viaToken = await t.tokenOnlyApp.request('/agent/v1/whoami', { headers: bearer(t.issueToken('nomir')) });
    expect(viaToken.status).toBe(200);
  });

  it('refuses a token that came through Cloudflare', async () => {
    const res = await t.withHeaders('/agent/v1/whoami', { ...bearer(t.issueToken('nomir')), 'CF-Ray': '8f1d2c3b4a5e6f70-FRA' });
    expect(res.status).toBe(403);
  });

  it('never opens the owner API', async () => {
    expect((await t.withHeaders('/api/me', bearer(t.issueToken('nomir')))).status).toBe(401);
  });
});

describe('static builds', () => {
  it('serves the owner shell with SPA fallback', async () => {
    expect(await (await t.get('/')).text()).toBe('<p>owner</p>');
    expect(await (await t.get('/history')).text()).toBe('<p>owner</p>');
  });

  it('caches hashed assets forever and revalidates the rest', async () => {
    expect((await t.get('/assets/app-abc123.js')).headers.get('cache-control')).toContain('immutable');
    expect((await t.get('/sw.js')).headers.get('cache-control')).toBe('no-cache');
  });

  it('serves the demo build under /demo/ with its own fallback', async () => {
    expect(await (await t.get('/demo/')).text()).toBe('<p>demo</p>');
    expect(await (await t.get('/demo/lesson')).text()).toBe('<p>demo</p>');
    expect((await t.get('/demo')).status).toBe(302);
  });

  it('returns 404 for missing files with an extension', async () => {
    expect((await t.get('/assets/missing.js')).status).toBe(404);
  });

  it('does not serve files outside the build directory', async () => {
    expect((await t.get('/%2e%2e/secret.txt')).status).toBe(404);
    expect((await t.get('/demo/%2e%2e/secret.txt')).status).toBe(404);
  });

  it('does not fall back to the shell under reserved prefixes', async () => {
    expect((await t.get('/agent/other')).status).toBe(404);
    expect((await t.get('/auth/whatever')).status).toBe(404);
  });
});

describe('config', () => {
  it('refuses to start in prod without Access settings', () => {
    expect(() => loadConfig({ APP_ENV: 'prod', DATA_DIR: '/tmp/x' })).toThrow(/ACCESS_TEAM_DOMAIN/);
  });

  it('runs in prod without the agent Access application', () => {
    const config = loadConfig({
      APP_ENV: 'prod',
      DATA_DIR: '/tmp/x',
      ACCESS_TEAM_DOMAIN: 'https://vta.cloudflareaccess.com',
      ACCESS_AUD_USER: 'a1',
    });
    expect(config.access).toMatchObject({ mode: 'cloudflare', userAudiences: ['a1'], agentAudiences: [] });
  });

  it('accepts a complete prod config and never uses dev auth there', () => {
    const config = loadConfig({
      APP_ENV: 'prod',
      DATA_DIR: '/tmp/x',
      ACCESS_TEAM_DOMAIN: 'https://vta.cloudflareaccess.com/',
      ACCESS_AUD_USER: 'a1, a2',
      ACCESS_AUD_AGENT: 'b1',
    });
    expect(config.access).toEqual({
      mode: 'cloudflare',
      teamDomain: 'https://vta.cloudflareaccess.com',
      userAudiences: ['a1', 'a2'],
      agentAudiences: ['b1'],
    });
  });
});
