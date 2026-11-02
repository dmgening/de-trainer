import { beforeEach, describe, expect, it } from 'vitest';
import { BankSnapshot, deriveState, DEFAULT_SCHEDULER_CONFIG, type LearnerEvent } from '@de-trainer/core';
import { FIXTURE_MEDIA } from '@de-trainer/fixtures';
import { attemptEvent, createTestServer, devPackage, type TestServer } from './helpers';

let t: TestServer;
beforeEach(async () => {
  t = await createTestServer();
});

const publish = (body: unknown) => t.json(t.call('nomir', 'POST', '/agent/v1/banks/dev/packages', body));

describe('publication through the agent API (A05)', () => {
  it('publishes a package and the learner downloads it without a rebuild', async () => {
    expect((await t.uploadFixtureMedia()).status).toBe(200);
    const res = await publish(devPackage());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ version: 1, status: 'published' });

    const pull = await t.json(t.call('alice', 'GET', '/api/sync/pull?since=0'));
    expect(pull.body.banks).toEqual([{ bank_id: 'dev', title: 'Dev', role: 'owner', version: 1 }]);
    const snap = await t.json(t.call('alice', 'GET', '/api/banks/dev/snapshot?version=1'));
    const parsed = BankSnapshot.parse(snap.body);
    expect(parsed.exercises.length).toBeGreaterThan(5);
    expect(parsed.media[0]).toMatchObject({ media_id: 'room', mime: 'image/png', width: 480 });

    const img = await t.call('alice', 'GET', `/api/media/${FIXTURE_MEDIA.room.sha256}`);
    expect(img.status).toBe(200);
    expect(img.headers.get('content-type')).toBe('image/png');
  });

  it('rejects a broken package as a whole, with paths Nomir can fix', async () => {
    await t.uploadFixtureMedia();
    await publish(devPackage());
    const broken = devPackage({ package_version: 2 });
    broken.exercises = [{ ...broken.exercises[0]!, revision: 2, primary_skill_id: 'nope' }, { ...broken.exercises[1]!, revision: 2, prompt: 'changed' }];
    const res = await publish(broken);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('invalid_package');
    expect(res.body.error.issues).toContainEqual({ path: 'exercises[0].primary_skill_id', message: 'Unknown or retired skill nope' });
    const versions = await t.json(t.call('alice', 'GET', '/api/banks/dev/versions'));
    expect(versions.body.head).toBe(1);
  });

  it('is idempotent for the same package and refuses a different one under the same version', async () => {
    await t.uploadFixtureMedia();
    await publish(devPackage());
    const again = await publish(devPackage());
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ version: 1, status: 'unchanged' });
    const conflict = await publish(devPackage({ changelog: 'other' }));
    expect(conflict.status).toBe(409);
  });

  it('validates without writing', async () => {
    await t.uploadFixtureMedia();
    const res = await t.json(t.call('nomir', 'POST', '/agent/v1/banks/dev/packages/validate', devPackage()));
    expect(res.body).toMatchObject({ status: 'valid', version: 1 });
    expect(res.body.diff.added.length).toBeGreaterThan(10);
    expect((await t.json(t.call('alice', 'GET', '/api/banks/dev/versions'))).body.head).toBeNull();
  });

  it('rolls back by adding a version with the older bank', async () => {
    await t.uploadFixtureMedia();
    await publish(devPackage());
    const v2 = devPackage({ package_version: 2, topics: [], skills: [], knowledge_items: [], media: [], exercises: [], retire: [{ kind: 'exercise', id: 'mit-bus' }] });
    expect((await publish(v2)).status).toBe(201);
    const rb = await t.json(t.call('alice', 'POST', '/api/banks/dev/rollback', { to_version: 1 }));
    expect(rb.body).toMatchObject({ version: 3, status: 'published' });
    const snap = BankSnapshot.parse((await t.json(t.call('alice', 'GET', '/api/banks/dev/snapshot'))).body);
    expect(snap.version).toBe(3);
    expect(snap.exercises.find((e) => e.exercise_id === 'mit-bus')?.status).toBe('published');
    const versions = await t.json(t.call('alice', 'GET', '/api/banks/dev/versions'));
    expect(versions.body.versions.map((v: { kind: string }) => v.kind)).toEqual(['rollback', 'publish', 'publish']);
  });

  it('keeps rollback to bank owners', async () => {
    await t.uploadFixtureMedia();
    await publish(devPackage());
    expect((await t.call('bob', 'POST', '/api/banks/dev/rollback', { to_version: 1 })).status).toBe(404);
  });
});

describe('revisions and key fixes (A06)', () => {
  it('a key fix stops old attempts from penalising the skill; history keeps the revision', async () => {
    await t.uploadFixtureMedia();
    await publish(devPackage());
    const wrong = attemptEvent(t.alice.userId, { exercise: 'perfekt-kommen', skill: 'perfekt-aux', result: 'wrong' });
    await t.call('alice', 'POST', '/api/sync/push', { events: [wrong] });

    const fixed = devPackage({ package_version: 2, topics: [], skills: [], knowledge_items: [], media: [] });
    const ex = fixed.exercises.find((e) => e.exercise_id === 'perfekt-kommen')!;
    fixed.exercises = [{ ...ex, revision: 2, key_fix: true, explanation: 'Исправлено объяснение.' }];
    expect((await publish(fixed)).status).toBe(201);

    const pull = await t.json<{ events: LearnerEvent[] }>(t.call('alice', 'GET', '/api/sync/pull?since=0'));
    const types = pull.body.events.map((e) => e.type);
    expect(types).toEqual(['attempt', 'attempts_invalidated']);
    const state = deriveState(pull.body.events, { bank_id: 'dev', config: DEFAULT_SCHEDULER_CONFIG });
    expect(state.invalidated_attempts).toBe(1);
    expect(state.units['skill:perfekt-aux']).toBeUndefined();
    const attempt = pull.body.events.find((e) => e.type === 'attempt');
    expect(attempt?.type === 'attempt' && attempt.payload.exercise_revision).toBe(1);
  });
});

describe('media upload', () => {
  it('accepts only raster images whose bytes match the hash', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const { createHash } = await import('node:crypto');
    const svgSha = createHash('sha256').update(svg).digest('hex');
    expect((await t.call('nomir', 'PUT', `/agent/v1/banks/dev/media/${svgSha}`, undefined, svg)).status).toBe(415);
    expect((await t.call('nomir', 'PUT', `/agent/v1/banks/dev/media/${'0'.repeat(64)}`, undefined, svg)).status).toBe(422);
  });

  it('serves a file only to members of a bank that holds it', async () => {
    await t.uploadFixtureMedia();
    expect((await t.call('bob', 'GET', `/api/media/${FIXTURE_MEDIA.room.sha256}`)).status).toBe(404);
    expect((await t.call(null, 'GET', `/api/media/${FIXTURE_MEDIA.room.sha256}`)).status).toBe(401);
  });
});

describe("Nomir's limits (A09, A15)", () => {
  it('cannot publish to a bank without a grant', async () => {
    expect((await t.call('nomir', 'POST', '/agent/v1/banks/bob/packages', devPackage({ bank_id: 'bob' }))).status).toBe(403);
  });

  it('cannot write learner events or rewrite the log', async () => {
    const attempt = attemptEvent(t.alice.userId, { exercise: 'x', skill: 's', result: 'correct' });
    const res = await t.call('nomir', 'POST', `/agent/v1/users/${t.alice.userId}/events`, { events: [{ type: 'attempt', payload: attempt.payload }] });
    expect(res.status).toBe(400);
    for (const method of ['DELETE', 'PUT', 'PATCH']) {
      expect((await t.call('nomir', method, `/agent/v1/users/${t.alice.userId}/events`, {})).status).toBe(404);
    }
    expect((await t.call('nomir', 'POST', '/agent/v1/users', { email: 'x@y.z' })).status).toBe(404);
  });

  it('cannot use the learner API with its service token', async () => {
    expect((await t.call('nomir', 'GET', '/api/sync/pull')).status).toBe(401);
  });

  it('gets readable errors without internals for HTML in content', async () => {
    await t.uploadFixtureMedia();
    const pkg = devPackage();
    pkg.exercises[0] = { ...pkg.exercises[0]!, prompt: '<img src=x onerror=alert(1)>' };
    const res = await publish(pkg);
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('HTML markup and entities are not allowed');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|stack|ACCESS_|nomir\.access/);
  });

  it('answers malformed JSON with 400', async () => {
    expect((await t.call('nomir', 'POST', '/agent/v1/banks/dev/packages', undefined, '{oops')).status).toBe(400);
  });

  it('publishes JSON Schemas for packages and priorities', async () => {
    const res = await t.json(t.call('nomir', 'GET', '/agent/v1/schema/package'));
    expect(res.status).toBe(200);
    expect(res.body.properties.exercises).toBeDefined();
  });
});
