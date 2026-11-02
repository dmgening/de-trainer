import { createReadStream, existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  CHECKER_VERSION,
  RollbackRequest,
  SCHEDULER_VERSION,
  SCHEMA_VERSION,
  Sha256,
  SyncPushRequest,
  type BankVersionsResponse,
  type MeResponse,
  type SyncPullResponse,
} from '@de-trainer/core';
import { userAuth } from '../auth/middleware';
import type { AccessVerifier } from '../auth/access';
import type { ContentService } from '../content/service';
import { zodIssues } from '../content/service';
import type { Db } from '../db/client';
import { listUserBanks } from '../db/repo';
import { apiError, handleContentError, readJson } from '../errors';
import { buildExport } from '../export';
import type { LearnerService } from '../learner/service';
import type { UserEnv } from '../types';

type Deps = {
  db: Db;
  verify: AccessVerifier;
  audiences: string[];
  allowCookie: boolean;
  content: ContentService;
  learner: LearnerService;
  logoutUrl: string;
};

const PULL_PAGE = 1000;

export function ownerRoutes(deps: Deps) {
  const { db, content, learner } = deps;
  const api = new Hono<UserEnv>();
  api.use('*', userAuth({ db, verify: deps.verify, audiences: deps.audiences, allowCookie: deps.allowCookie }));

  // Every handler below reads data only for c.get('user').userId and the banks that user belongs to.
  const memberOf = (userId: string, bankId: string) => listUserBanks(db, userId).find((b) => b.bankId === bankId);

  api.get('/me', (c) => {
    const user = c.get('user');
    const body: MeResponse = {
      user_id: user.userId,
      email: user.email,
      display_name: user.displayName,
      banks: listUserBanks(db, user.userId).map((b) => ({ bank_id: b.bankId, title: b.title, role: b.role })),
      schema_version: SCHEMA_VERSION,
      scheduler_version: SCHEDULER_VERSION,
      checker_version: CHECKER_VERSION,
      logout_url: deps.logoutUrl,
    };
    return c.json(body);
  });

  api.post('/sync/push', bodyLimit({ maxSize: 2 * 1024 * 1024, onError: (c) => apiError(c, 413, 'too_large', 'Batch too large') }), async (c) => {
    const user = c.get('user');
    const json = await readJson(c);
    if (!json.ok) return json.res;
    const parsed = SyncPushRequest.safeParse(json.body);
    if (!parsed.success) return apiError(c, 400, 'invalid_events', 'Events do not match the schema', zodIssues(parsed.error));
    const banks = new Set(listUserBanks(db, user.userId).map((b) => b.bankId));
    for (const [i, e] of parsed.data.events.entries()) {
      if (e.user_id !== user.userId) return apiError(c, 403, 'user_mismatch', `events[${i}] belongs to another user`);
      // session_finished has no bank_id; every other client event does.
      const bankId = 'bank_id' in e.payload ? e.payload.bank_id : null;
      if (bankId !== null && !banks.has(bankId)) return apiError(c, 403, 'forbidden', `events[${i}] refers to a bank you are not a member of`);
    }
    return c.json(learner.append(user.userId, parsed.data.events, `user:${user.userId}`));
  });

  api.get('/sync/pull', (c) => {
    const user = c.get('user');
    const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
    const page = learner.list(user.userId, { since, limit: PULL_PAGE });
    const body: SyncPullResponse = {
      ...page,
      banks: listUserBanks(db, user.userId).map((b) => ({ bank_id: b.bankId, title: b.title, role: b.role, version: content.head(b.bankId) })),
      recommendations: learner.recommendations(user.userId),
      scheduler_config: learner.schedulerConfig(user.userId),
    };
    return c.json(body);
  });

  api.get('/banks/:bank_id/snapshot', (c) => {
    const user = c.get('user');
    const bankId = c.req.param('bank_id');
    if (!memberOf(user.userId, bankId)) return apiError(c, 404, 'not_found', 'Unknown bank');
    const version = Number(c.req.query('version') ?? content.head(bankId));
    const json = Number.isInteger(version) && version > 0 ? content.snapshot(bankId, version) : null;
    if (!json) return apiError(c, 404, 'not_found', 'No such bank version');
    c.header('Cache-Control', 'private, no-cache');
    return c.body(json, 200, { 'Content-Type': 'application/json; charset=utf-8' });
  });

  api.get('/banks/:bank_id/versions', (c) => {
    const user = c.get('user');
    const bankId = c.req.param('bank_id');
    if (!memberOf(user.userId, bankId)) return apiError(c, 404, 'not_found', 'Unknown bank');
    const body: BankVersionsResponse = { bank_id: bankId, head: content.head(bankId), versions: content.versions(bankId) };
    return c.json(body);
  });

  api.post('/banks/:bank_id/rollback', async (c) => {
    const user = c.get('user');
    const bankId = c.req.param('bank_id');
    const member = memberOf(user.userId, bankId);
    if (!member) return apiError(c, 404, 'not_found', 'Unknown bank');
    if (member.role !== 'owner') return apiError(c, 403, 'forbidden', 'Only the bank owner can roll back');
    const json = await readJson(c);
    if (!json.ok) return json.res;
    const parsed = RollbackRequest.safeParse(json.body);
    if (!parsed.success) return apiError(c, 400, 'invalid_request', 'to_version is required', zodIssues(parsed.error));
    try {
      return c.json(content.rollback(bankId, parsed.data.to_version, `user:${user.userId}`));
    } catch (err) {
      return handleContentError(c, err);
    }
  });

  api.get('/media/:sha256', (c) => {
    const user = c.get('user');
    const sha = c.req.param('sha256');
    if (!Sha256.safeParse(sha).success) return apiError(c, 404, 'not_found', 'Unknown media');
    const found = content.mediaForUser(user.userId, sha);
    if (!found || !existsSync(found.file)) return apiError(c, 404, 'not_found', 'Unknown media');
    return new Response(Readable.toWeb(createReadStream(found.file)) as ReadableStream, {
      headers: { 'Content-Type': found.mime, 'Cache-Control': 'private, max-age=31536000, immutable' },
    });
  });

  api.get('/export', (c) => {
    const user = c.get('user');
    const file = buildExport({ db, content, learner }, user);
    const date = file.exported_at.slice(0, 10);
    c.header('Content-Disposition', `attachment; filename="de-class-export-${date}.json"`);
    c.header('Cache-Control', 'no-store');
    return c.json(file);
  });

  api.all('*', (c) => apiError(c, 404, 'not_found', 'Unknown API route'));
  return api;
}
