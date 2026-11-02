import { beforeEach, describe, expect, it } from 'vitest';
import {
  BankSnapshot,
  DEFAULT_SCHEDULER_CONFIG,
  ExportFile,
  activeRecommendations,
  buildSession,
  deriveState,
  summarize,
  uuidv7,
  type ClientEvent,
  type LearnerEvent,
} from '@de-trainer/core';
import { attemptEvent, createTestServer, devPackage, type TestServer } from './helpers';

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer();
  await t.uploadFixtureMedia();
  await t.call('nomir', 'POST', '/agent/v1/banks/dev/packages', devPackage());
});

const push = (who: 'alice' | 'bob', events: ClientEvent[]) => t.json(t.call(who, 'POST', '/api/sync/push', { events }));
const pull = (who: 'alice' | 'bob', since = 0) => t.json<{ events: (LearnerEvent & { seq: number; clock_suspect: boolean })[]; max_seq: number; has_more: boolean; recommendations: any; scheduler_config: any }>(t.call(who, 'GET', `/api/sync/pull?since=${since}`));

describe('push and pull (A11, A12)', () => {
  it('stores events once, however often a device resends them', async () => {
    const e = attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'correct' });
    expect((await push('alice', [e])).body).toEqual({ accepted: 1, duplicates: 0, max_seq: 1 });
    expect((await push('alice', [e])).body).toEqual({ accepted: 0, duplicates: 1, max_seq: 1 });
    const p = await pull('alice');
    expect(p.body.events).toHaveLength(1);
    expect(p.body.events[0]).toMatchObject({ event_id: e.event_id, seq: 1, clock_suspect: false });
  });

  it('merges two devices without losses and both derive the same state as the server', async () => {
    const day = (d: number, h: number) => `2026-11-0${d}T0${h}:00:00.000Z`;
    const a = [
      attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'correct', ts: day(1, 8), device: 'phone' }),
      attemptEvent(t.alice.userId, { exercise: 'mit-zug', skill: 'mit-dativ', result: 'correct', ts: day(2, 8), device: 'phone' }),
    ];
    const b = [
      attemptEvent(t.alice.userId, { exercise: 'wo-katze', skill: 'wo-dativ', result: 'wrong', ts: day(1, 9), device: 'laptop' }),
      attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'wrong', ts: day(3, 9), device: 'laptop' }),
    ];
    // The laptop was offline and sends later; order of arrival must not matter.
    await push('alice', a);
    const phoneCursor = (await pull('alice')).body.max_seq;
    await push('alice', b);

    const all = (await pull('alice')).body.events;
    expect(all.map((e) => e.event_id).sort()).toEqual([...a, ...b].map((e) => e.event_id).sort());
    const phoneSees = [...a, ...(await pull('alice', phoneCursor)).body.events];
    const opts = { bank_id: 'dev', config: DEFAULT_SCHEDULER_CONFIG };
    const server = await t.json(t.call('nomir', 'GET', `/agent/v1/users/${t.alice.userId}/state`));
    expect(deriveState(phoneSees, opts)).toEqual(server.body.banks[0].state);
    expect(deriveState(all, opts)).toEqual(server.body.banks[0].state);
  });

  it('marks events from a clock in the future', async () => {
    const future = attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'correct', ts: '2099-01-01T00:00:00.000Z' });
    await push('alice', [future]);
    expect((await pull('alice')).body.events[0]?.clock_suspect).toBe(true);
  });

  it('pages long logs', async () => {
    const events = Array.from({ length: 450 }, () => attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'correct' }));
    await push('alice', events);
    await push('alice', Array.from({ length: 450 }, () => attemptEvent(t.alice.userId, { exercise: 'mit-zug', skill: 'mit-dativ', result: 'correct' })));
    await push('alice', Array.from({ length: 200 }, () => attemptEvent(t.alice.userId, { exercise: 'wo-katze', skill: 'wo-dativ', result: 'correct' })));
    const first = await pull('alice');
    expect(first.body.events).toHaveLength(1000);
    expect(first.body.has_more).toBe(true);
    const second = await pull('alice', first.body.max_seq);
    expect(second.body.events).toHaveLength(100);
    expect(second.body.has_more).toBe(false);
  });

  it('refuses events for another user or a foreign bank', async () => {
    expect((await push('alice', [attemptEvent(t.bob.userId, { exercise: 'x', skill: 's', result: 'correct' })])).status).toBe(403);
    const foreign = attemptEvent(t.alice.userId, { exercise: 'x', skill: 's', result: 'correct' });
    if (foreign.type === 'attempt') foreign.payload.bank_id = 'bob';
    expect((await push('alice', [foreign])).status).toBe(403);
  });

  it('refuses malformed events with field paths', async () => {
    const res = await t.json(t.call('alice', 'POST', '/api/sync/push', { events: [{ type: 'attempt', event_id: 'x' }] }));
    expect(res.status).toBe(400);
    expect(res.body.error.issues.length).toBeGreaterThan(0);
  });
});

describe("Nomir's cycle (A16, A17)", () => {
  it('reads raw answers, publishes priorities, and the next session follows them with his reason', async () => {
    const wrong = attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'wrong' });
    await push('alice', [wrong]);

    const log = await t.json(t.call('nomir', 'GET', `/agent/v1/users/${t.alice.userId}/events?types=attempt`));
    expect(log.body.events[0].payload.response).toEqual({ type: 'choice', option_id: 'b' });
    expect(JSON.stringify(log.body)).not.toContain('alice@example.com');

    const diag = await t.call('nomir', 'POST', `/agent/v1/users/${t.alice.userId}/events`, {
      events: [{ type: 'diagnosis', payload: { attempt_ids: [wrong.event_id], skill_ids: ['mit-dativ'], note: 'Путает Dativ и Akkusativ после mit' } }],
    });
    expect(diag.status).toBe(200);

    const set = {
      generated_at: new Date().toISOString(),
      recommendations: [
        { recommendation_id: 'r1', scope: { type: 'skill', id: 'mit-dativ' }, weight: 1, reason: 'Ошибки в Dativ после mit', expires_at: '2099-01-01T00:00:00Z' },
      ],
    };
    expect((await t.call('nomir', 'PUT', `/agent/v1/users/${t.alice.userId}/recommendations`, set)).status).toBe(200);

    const p = await pull('alice');
    expect(p.body.recommendations.version).toBe(1);
    const snapshot = BankSnapshot.parse((await t.json(t.call('alice', 'GET', '/api/banks/dev/snapshot'))).body);
    const plan = buildSession({
      bank: snapshot,
      state: deriveState(p.body.events, { bank_id: 'dev', config: p.body.scheduler_config.config }),
      recommendations: activeRecommendations(p.body.recommendations.set, new Date()),
      config: p.body.scheduler_config.config,
      seed: 'next',
      today: new Date().toISOString().slice(0, 10),
      size: 5,
      mode: 'recommended',
    });
    expect(plan.filter((i) => i.reason.code === 'nomir').map((i) => i.reason.text)).toContain('Ошибки в Dativ после mit');
  });

  it('a flagged exercise stays hidden until Nomir resolves it', async () => {
    const flag: ClientEvent = {
      event_id: uuidv7(),
      user_id: t.alice.userId,
      device_id: 'phone',
      client_ts: new Date().toISOString(),
      type: 'exercise_flagged',
      payload: { flag_id: uuidv7(), bank_id: 'dev', exercise_id: 'mit-bus', revision: 1, comment: 'Спорный ключ' },
    };
    await push('alice', [flag]);
    const opts = { bank_id: 'dev', config: DEFAULT_SCHEDULER_CONFIG };
    const flagged = await t.json(t.call('nomir', 'GET', `/agent/v1/users/${t.alice.userId}/events?types=exercise_flagged`));
    expect(flagged.body.events).toHaveLength(1);
    expect(deriveState((await pull('alice')).body.events, opts).flagged['mit-bus']).toBeDefined();

    await t.call('nomir', 'POST', `/agent/v1/users/${t.alice.userId}/events`, {
      events: [{ type: 'flag_resolved', payload: { bank_id: 'dev', exercise_id: 'mit-bus', flag_id: flag.payload.flag_id, decision: 'rejected', note: 'Ключ верный' } }],
    });
    expect(deriveState((await pull('alice')).body.events, opts).flagged['mit-bus']).toBeUndefined();
  });

  it('tunes the scheduler only inside the bounds', async () => {
    const bad = { ...DEFAULT_SCHEDULER_CONFIG, default_session_size: 500 };
    expect((await t.call('nomir', 'PUT', `/agent/v1/users/${t.alice.userId}/scheduler-config`, bad)).status).toBe(422);
    const good = { ...DEFAULT_SCHEDULER_CONFIG, weights: { weak: 0.5, recent: 0.2, due: 0.2, variety: 0.1 } };
    expect((await t.call('nomir', 'PUT', `/agent/v1/users/${t.alice.userId}/scheduler-config`, good)).status).toBe(200);
    expect((await pull('alice')).body.scheduler_config).toEqual({ version: 1, config: good });
  });
});

describe('two learners (A18)', () => {
  it('neither learner nor a token granted for one sees the other', async () => {
    await push('alice', [attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'correct' })]);
    expect((await pull('bob')).body.events).toEqual([]);
    expect((await t.call('bob', 'GET', '/api/banks/dev/snapshot')).status).toBe(404);
    expect((await t.call('bob', 'GET', '/api/banks/dev/versions')).status).toBe(404);
    for (const path of ['events', 'state', 'recommendations', 'scheduler-config']) {
      expect((await t.call('nomir', 'GET', `/agent/v1/users/${t.bob.userId}/${path}`)).status).toBe(403);
    }
    const users = await t.json(t.call('nomir', 'GET', '/agent/v1/users'));
    expect(users.body.users.map((u: { user_id: string }) => u.user_id)).toEqual([t.alice.userId]);
    expect(JSON.stringify(users.body)).not.toMatch(/@example\.com|Alice/);
  });
});

describe('export and restore (A07)', () => {
  it('keeps the count and IDs of attempts, and the summary is rebuilt from the log', async () => {
    const events = [
      attemptEvent(t.alice.userId, { exercise: 'mit-bus', skill: 'mit-dativ', result: 'correct', ts: '2026-11-01T08:00:00.000Z' }),
      attemptEvent(t.alice.userId, { exercise: 'mit-zug', skill: 'mit-dativ', result: 'wrong', ts: '2026-11-02T08:00:00.000Z' }),
    ];
    await push('alice', events);
    const res = await t.call('alice', 'GET', '/api/export');
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const file = ExportFile.parse(await res.json());
    expect(file.period).toMatchObject({ complete: true, max_seq: 2 });

    // Restore into a fresh server, the way the admin CLI does.
    const fresh = await createTestServer();
    const { createLearnerService } = await import('../src/learner/service');
    createLearnerService(fresh.db).restore(fresh.alice.userId, file.events as never);
    const restored = (await fresh.json(fresh.call('alice', 'GET', '/api/sync/pull?since=0'))).body.events as LearnerEvent[];
    expect(restored.map((e) => e.event_id)).toEqual(events.map((e) => e.event_id));
    expect(summarize(restored, { bank_id: 'dev', config: DEFAULT_SCHEDULER_CONFIG })).toEqual(file.summary[0]);
  });
});
