import { describe, expect, it } from 'vitest';
import { ContentPackage, type ContentPackageInput } from './content';
import { objectKey, stableStringify } from './primitives';
import { EMPTY_MANIFEST, buildSnapshot, planPublication, type PublishContext } from './publish';

const SHA = 'a'.repeat(64);

function pkg(over: Partial<ContentPackageInput> = {}): ContentPackage {
  return ContentPackage.parse({
    schema_version: 1,
    bank_id: 'b',
    package_id: 'p',
    package_version: 1,
    created_at: '2026-11-01T00:00:00Z',
    audience: 'owner',
    changelog: 'test',
    topics: [{ topic_id: 't', revision: 1, title: 'T', lesson_order: 1 }],
    skills: [{ skill_id: 's', revision: 1, title: 'S' }],
    knowledge_items: [{ item_id: 'i', revision: 1, label: 'I', kind: 'word' }],
    exercises: [
      {
        exercise_id: 'e',
        revision: 1,
        family_id: 'f',
        status: 'published',
        topic_ids: ['t'],
        primary_skill_id: 's',
        knowledge_item_ids: ['i'],
        prompt: 'p',
        explanation: 'x',
        answer_spec: { type: 'choice', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correct: ['a'] },
      },
    ],
    ...over,
  });
}

/** Applies plans in memory the way the server does, to test sequences of publications. */
function bankStore() {
  const known = new Map<string, Map<number, string>>();
  const bodies = new Map<string, unknown>();
  const knownMedia = new Map<string, string>();
  let manifest = EMPTY_MANIFEST;
  const ctx = (): PublishContext => ({
    bankId: 'b',
    audience: 'owner',
    manifest,
    bodies: new Map(Object.entries(manifest.objects).map(([k, v]) => [k, bodies.get(`${k}@${v.revision}`)])),
    known,
    knownMedia,
    uploadedMedia: new Set([SHA]),
    hash: stableStringify,
  });
  return {
    publish(p: ContentPackage) {
      const r = planPublication(p, ctx());
      if (r.ok) {
        for (const o of r.plan.inserts) {
          const key = objectKey(o.kind, o.id);
          if (!known.has(key)) known.set(key, new Map());
          known.get(key)!.set(o.revision, o.hash);
          bodies.set(`${key}@${o.revision}`, o.body);
        }
        for (const [id, sha] of Object.entries(r.plan.manifest.media)) knownMedia.set(id, sha);
        manifest = r.plan.manifest;
      }
      return r;
    },
    get manifest() {
      return manifest;
    },
    snapshot() {
      const b = new Map(Object.entries(manifest.objects).map(([k, v]) => [k, bodies.get(`${k}@${v.revision}`)]));
      return buildSnapshot({ bankId: 'b', version: 1, createdAt: '2026-11-01T00:00:00Z', manifest, bodies: b, media: new Map([[SHA, { mime: 'image/png', bytes: 1, width: 1, height: 1 }]]) });
    },
  };
}

const exercise = (over: Record<string, unknown>) => ({ ...pkg().exercises[0]!, ...over });

describe('package publication (A05, A06)', () => {
  it('publishes a valid package and reports what was added', () => {
    const r = bankStore().publish(pkg());
    expect(r.ok && r.plan.diff.added).toEqual(['topic:t', 'skill:s', 'knowledge_item:i', 'exercise:e']);
  });

  it('rejects the whole package when one reference is broken', () => {
    const store = bankStore();
    const r = store.publish(pkg({ exercises: [exercise({ primary_skill_id: 'missing' })] }));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.issues[0]).toEqual({ path: 'exercises[0].primary_skill_id', message: 'Unknown or retired skill missing' });
    expect(store.manifest).toEqual(EMPTY_MANIFEST);
  });

  it('applies a later package as a patch: untouched objects stay', () => {
    const store = bankStore();
    store.publish(pkg());
    const r = store.publish(pkg({ package_version: 2, topics: [], skills: [], knowledge_items: [], exercises: [exercise({ exercise_id: 'e2' })] }));
    expect(r.ok && r.plan.diff).toEqual({ added: ['exercise:e2'], changed: [], retired: [] });
    expect(Object.keys(store.manifest.objects)).toContain('exercise:e');
  });

  it('requires a higher revision for changed content', () => {
    const store = bankStore();
    store.publish(pkg());
    const same = store.publish(pkg({ package_version: 2, exercises: [exercise({ prompt: 'changed' })] }));
    expect(!same.ok && same.issues[0]?.message).toMatch(/already exists with other content/);
    const bumped = store.publish(pkg({ package_version: 2, exercises: [exercise({ prompt: 'changed', revision: 2 })] }));
    expect(bumped.ok && bumped.plan.diff.changed).toEqual(['exercise:e']);
  });

  it('refuses a package that changes nothing', () => {
    const store = bankStore();
    store.publish(pkg());
    const r = store.publish(pkg({ package_version: 2 }));
    expect(!r.ok && r.issues[0]?.message).toMatch(/changes nothing/);
  });

  it('retires explicitly and keeps retired exercises for history', () => {
    const store = bankStore();
    store.publish(pkg());
    const r = store.publish(pkg({ package_version: 2, topics: [], skills: [], knowledge_items: [], exercises: [], retire: [{ kind: 'exercise', id: 'e' }] }));
    expect(r.ok && r.plan.diff.retired).toEqual(['exercise:e']);
    expect(store.snapshot().exercises[0]?.status).toBe('retired');
  });

  it('does not let a skill be retired while a published exercise uses it', () => {
    const store = bankStore();
    store.publish(pkg());
    const r = store.publish(pkg({ package_version: 2, topics: [], skills: [], knowledge_items: [], exercises: [], retire: [{ kind: 'skill', id: 's' }] }));
    expect(!r.ok && r.issues[0]?.message).toBe('Unknown or retired skill s');
  });

  it('reports key fixes so attempts on older revisions can be invalidated', () => {
    const store = bankStore();
    store.publish(pkg());
    const r = store.publish(pkg({ package_version: 2, exercises: [exercise({ revision: 2, key_fix: true, answer_spec: { type: 'choice', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correct: ['b'] } })] }));
    expect(r.ok && r.plan.keyFixes).toEqual([{ exercise_id: 'e', revision: 2 }]);
  });

  it('requires uploaded media and never rebinds a media ID', () => {
    const store = bankStore();
    const missing = store.publish(pkg({ media: [{ media_id: 'm', sha256: 'b'.repeat(64) }] }));
    expect(!missing.ok && missing.issues[0]?.message).toMatch(/not uploaded/);
    expect(store.publish(pkg({ media: [{ media_id: 'm', sha256: SHA }] })).ok).toBe(true);
    const rebind = store.publish(pkg({ package_version: 2, media: [{ media_id: 'm', sha256: 'c'.repeat(64) }] }));
    expect(!rebind.ok && rebind.issues[0]?.message).toMatch(/another file/);
  });

  it('leaves drafts out of the learner snapshot', () => {
    const store = bankStore();
    store.publish(pkg({ exercises: [exercise({ status: 'draft' })] }));
    expect(store.snapshot().exercises).toEqual([]);
  });

  it('keeps workbook locators out of demo packages', () => {
    const r = ContentPackage.safeParse({ ...pkg(), audience: 'demo', topics: [{ topic_id: 't', revision: 1, title: 'T', lesson_order: 1, source_refs: [{ doc: 'secret' }] }] });
    expect(r.success).toBe(false);
  });
});
