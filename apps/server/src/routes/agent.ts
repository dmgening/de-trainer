import { eq } from 'drizzle-orm';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import {
  AGENT_EVENT_TYPES,
  AgentEventInput,
  LIMITS,
  RecommendationSet,
  RollbackRequest,
  SchedulerConfig,
  Sha256,
  deriveState,
  uuidv7,
  type AgentWhoamiResponse,
  type LearnerEvent,
  type Permission,
} from '@de-trainer/core';
import { agentAuth } from '../auth/middleware';
import type { AccessVerifier } from '../auth/access';
import { zodIssues, type ContentService } from '../content/service';
import type { Db } from '../db/client';
import { listUserBanks } from '../db/repo';
import { users } from '../db/schema';
import { apiError, handleContentError, readJson } from '../errors';
import type { LearnerService } from '../learner/service';
import { agentSchemas } from '../schemas';
import type { AgentEnv, AuthedAgent } from '../types';

type Deps = { db: Db; verify: AccessVerifier; audiences: string[]; content: ContentService; learner: LearnerService };

const can = (agent: AuthedAgent, scopeType: 'user' | 'bank', scopeId: string, permission: Permission) =>
  agent.grants.some((g) => g.scopeType === scopeType && g.scopeId === scopeId && g.permission === permission);

/**
 * Nomir's API. Every route checks a grant on the exact user or bank in the path; users are visible
 * only by opaque user_id (no email, no name). Nomir can add events but never change or delete them.
 */
export function agentRoutes(deps: Deps) {
  const { db, content, learner } = deps;
  const agent = new Hono<AgentEnv>();
  agent.use('*', agentAuth({ db, verify: deps.verify, audiences: deps.audiences, allowCookie: false }));

  const actor = (c: Context<AgentEnv>) => `agent:${c.get('agent').name}`;
  const deny = (c: Context<AgentEnv>) => apiError(c, 403, 'forbidden', 'No grant for this resource');
  const userExists = (userId: string) => !!db.select({ id: users.userId }).from(users).where(eq(users.userId, userId)).get();

  /** Grant first, existence second: without a grant the agent cannot even learn whether a user exists. */
  const forUser = (c: Context<AgentEnv>, permission: Permission): { res: Response } | { userId: string } => {
    const userId = c.req.param('user_id')!;
    if (!can(c.get('agent'), 'user', userId, permission)) return { res: deny(c) };
    if (!userExists(userId)) return { res: apiError(c, 404, 'not_found', 'Unknown user') };
    return { userId };
  };
  const forBank = (c: Context<AgentEnv>, permission: Permission): { res: Response } | { bankId: string } => {
    const bankId = c.req.param('bank_id')!;
    if (!can(c.get('agent'), 'bank', bankId, permission)) return { res: deny(c) };
    return { bankId };
  };

  agent.get('/whoami', (c) => {
    const a = c.get('agent');
    const body: AgentWhoamiResponse = {
      agent_id: a.agentId,
      name: a.name,
      grants: a.grants.map((g) => ({ scope_type: g.scopeType, scope_id: g.scopeId, permission: g.permission })),
    };
    return c.json(body);
  });

  agent.get('/users', (c) => {
    const a = c.get('agent');
    const ids = [...new Set(a.grants.filter((g) => g.scopeType === 'user').map((g) => g.scopeId))].filter(userExists);
    return c.json({
      users: ids.map((id) => ({
        user_id: id,
        banks: listUserBanks(db, id).map((b) => b.bankId),
        permissions: a.grants.filter((g) => g.scopeType === 'user' && g.scopeId === id).map((g) => g.permission),
      })),
    });
  });

  agent.get('/users/:user_id/events', (c) => {
    const r = forUser(c, 'events:read');
    if ('res' in r) return r.res;
    const since = Math.max(0, Number(c.req.query('since') ?? 0) || 0);
    const limit = Math.min(5000, Math.max(1, Number(c.req.query('limit') ?? 1000) || 1000));
    const types = c.req.query('types')?.split(',').filter(Boolean);
    return c.json(learner.list(r.userId, { since, limit, types }));
  });

  agent.post('/users/:user_id/events', bodyLimit({ maxSize: 1024 * 1024, onError: (c) => apiError(c, 413, 'too_large', 'Batch too large') }), async (c) => {
    const r = forUser(c, 'events:write');
    if ('res' in r) return r.res;
    const json = await readJson(c);
    if (!json.ok) return json.res;
    const parsed = z.strictObject({ events: z.array(AgentEventInput).min(1).max(500) }).safeParse(json.body);
    if (!parsed.success) {
      return apiError(c, 400, 'invalid_events', `Only ${AGENT_EVENT_TYPES.join(', ')} events are accepted`, zodIssues(parsed.error));
    }
    const banks = new Set(listUserBanks(db, r.userId).map((b) => b.bankId));
    const now = new Date().toISOString();
    const batch: LearnerEvent[] = [];
    for (const [i, e] of parsed.data.events.entries()) {
      if ('bank_id' in e.payload && !banks.has(e.payload.bank_id)) {
        return apiError(c, 422, 'unknown_bank', `events[${i}]: the user is not a member of bank ${e.payload.bank_id}`);
      }
      batch.push({ ...e, event_id: e.event_id ?? uuidv7(), user_id: r.userId, device_id: actor(c), client_ts: now } as LearnerEvent);
    }
    return c.json(learner.append(r.userId, batch, actor(c)));
  });

  agent.get('/users/:user_id/state', (c) => {
    const r = forUser(c, 'events:read');
    if ('res' in r) return r.res;
    const events = learner.all(r.userId);
    const { version, config } = learner.schedulerConfig(r.userId);
    return c.json({
      user_id: r.userId,
      scheduler_config_version: version,
      banks: listUserBanks(db, r.userId).map((b) => ({ bank_id: b.bankId, state: deriveState(events, { bank_id: b.bankId, config }) })),
    });
  });

  agent.get('/users/:user_id/recommendations', (c) => {
    const r = forUser(c, 'recommendations:write');
    if ('res' in r) return r.res;
    return c.json(learner.recommendations(r.userId));
  });

  agent.put('/users/:user_id/recommendations', async (c) => {
    const r = forUser(c, 'recommendations:write');
    if ('res' in r) return r.res;
    const json = await readJson(c);
    if (!json.ok) return json.res;
    const parsed = RecommendationSet.safeParse(json.body);
    if (!parsed.success) return apiError(c, 422, 'invalid_recommendations', 'Recommendations do not match the schema', zodIssues(parsed.error));
    return c.json({ version: learner.putRecommendations(r.userId, parsed.data, actor(c)) });
  });

  agent.get('/users/:user_id/scheduler-config', (c) => {
    const r = forUser(c, 'scheduler:write');
    if ('res' in r) return r.res;
    return c.json(learner.schedulerConfig(r.userId));
  });

  agent.put('/users/:user_id/scheduler-config', async (c) => {
    const r = forUser(c, 'scheduler:write');
    if ('res' in r) return r.res;
    const json = await readJson(c);
    if (!json.ok) return json.res;
    const parsed = SchedulerConfig.safeParse(json.body);
    if (!parsed.success) return apiError(c, 422, 'out_of_bounds', 'Scheduler config is outside the allowed bounds', zodIssues(parsed.error));
    return c.json({ version: learner.putSchedulerConfig(r.userId, parsed.data, actor(c)) });
  });

  agent.get('/banks/:bank_id', (c) => {
    const r = forBank(c, 'bank:publish');
    if ('res' in r) return r.res;
    try {
      return c.json({ ...content.current(r.bankId), versions: content.versions(r.bankId) });
    } catch (err) {
      return handleContentError(c, err);
    }
  });

  agent.put('/banks/:bank_id/media/:sha256', bodyLimit({ maxSize: LIMITS.mediaBytes, onError: (c) => apiError(c, 413, 'too_large', `Images are limited to ${LIMITS.mediaBytes} bytes`) }), async (c) => {
    const r = forBank(c, 'bank:publish');
    if ('res' in r) return r.res;
    const sha = c.req.param('sha256');
    if (!Sha256.safeParse(sha).success) return apiError(c, 400, 'invalid_hash', 'The URL must end with the lowercase hex sha256 of the file');
    try {
      return c.json(content.putMedia(r.bankId, sha, Buffer.from(await c.req.arrayBuffer())));
    } catch (err) {
      return handleContentError(c, err);
    }
  });

  const packageLimit = bodyLimit({ maxSize: LIMITS.packageBytes, onError: (c) => apiError(c, 413, 'too_large', `Packages are limited to ${LIMITS.packageBytes} bytes`) });

  agent.post('/banks/:bank_id/packages/validate', packageLimit, async (c) => {
    const r = forBank(c, 'bank:publish');
    if ('res' in r) return r.res;
    const json = await readJson(c);
    if (!json.ok) return json.res;
    try {
      return c.json(content.validate(r.bankId, json.body));
    } catch (err) {
      return handleContentError(c, err);
    }
  });

  agent.post('/banks/:bank_id/packages', packageLimit, async (c) => {
    const r = forBank(c, 'bank:publish');
    if ('res' in r) return r.res;
    const json = await readJson(c);
    if (!json.ok) return json.res;
    try {
      const result = content.publish(r.bankId, json.body, actor(c));
      return c.json(result, result.status === 'published' ? 201 : 200);
    } catch (err) {
      return handleContentError(c, err);
    }
  });

  agent.post('/banks/:bank_id/rollback', async (c) => {
    const r = forBank(c, 'bank:publish');
    if ('res' in r) return r.res;
    const json = await readJson(c);
    if (!json.ok) return json.res;
    const parsed = RollbackRequest.safeParse(json.body);
    if (!parsed.success) return apiError(c, 400, 'invalid_request', 'to_version is required', zodIssues(parsed.error));
    try {
      return c.json(content.rollback(r.bankId, parsed.data.to_version, actor(c)));
    } catch (err) {
      return handleContentError(c, err);
    }
  });

  agent.get('/schema', (c) => c.json({ schemas: Object.keys(agentSchemas) }));
  agent.get('/schema/:name', (c) => {
    const schema = agentSchemas[c.req.param('name') as keyof typeof agentSchemas];
    return schema ? c.json(schema) : apiError(c, 404, 'not_found', 'Unknown schema');
  });

  agent.all('*', (c) => apiError(c, 404, 'not_found', 'Unknown agent API route'));
  return agent;
}

