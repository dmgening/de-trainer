import {
  SCHEMA_VERSION,
  type BankSnapshot,
  type ContentPackage,
  type Exercise,
  type KnowledgeItem,
  type MediaInfo,
  type ObjectKind,
  type Skill,
  type Topic,
} from './content';
import { objectKey, stableStringify } from './primitives';

/** Which revision of each object makes up a bank version. Topics, skills and items absent from it are retired. */
export type BankManifest = {
  /** Retired exercises stay listed (retired: true) so history can still show them. */
  objects: Record<string, { revision: number; retired?: boolean }>;
  /** media_id → sha256 */
  media: Record<string, string>;
};
export const EMPTY_MANIFEST: BankManifest = { objects: {}, media: {} };

export type PublishContext = {
  bankId: string;
  audience: 'owner' | 'demo';
  manifest: BankManifest;
  /** Bodies of the revisions listed in the manifest. */
  bodies: Map<string, unknown>;
  /** Every revision ever stored in the bank, with its content hash. */
  known: Map<string, Map<number, string>>;
  /** media_id → sha256 ever used in the bank: a media ID is never rebound to another file. */
  knownMedia: Map<string, string>;
  uploadedMedia: Set<string>;
  hash: (body: unknown) => string;
};

export type PublishIssue = { path: string; message: string };
export type Diff = { added: string[]; changed: string[]; retired: string[] };
export type PublishPlan = {
  manifest: BankManifest;
  inserts: { kind: ObjectKind; id: string; revision: number; hash: string; body: unknown }[];
  diff: Diff;
  keyFixes: { exercise_id: string; revision: number }[];
};

type Versioned = { revision: number };
const sections = [
  ['topic', 'topics', (o: Topic) => o.topic_id],
  ['skill', 'skills', (o: Skill) => o.skill_id],
  ['knowledge_item', 'knowledge_items', (o: KnowledgeItem) => o.item_id],
  ['exercise', 'exercises', (o: Exercise) => o.exercise_id],
] as const;

/**
 * Checks a package against the current bank and computes the next version, without writing anything.
 * A package is a patch: objects it does not mention stay as they are; retiring is explicit.
 */
export function planPublication(pkg: ContentPackage, ctx: PublishContext): { ok: true; plan: PublishPlan } | { ok: false; issues: PublishIssue[] } {
  const issues: PublishIssue[] = [];
  const issue = (path: string, message: string) => issues.push({ path, message });
  if (pkg.bank_id !== ctx.bankId) issue('bank_id', `Package is for bank ${pkg.bank_id}, not ${ctx.bankId}`);
  if (pkg.audience !== ctx.audience) issue('audience', `Bank ${ctx.bankId} is ${ctx.audience}, package says ${pkg.audience}`);

  const manifest: BankManifest = { objects: { ...ctx.manifest.objects }, media: { ...ctx.manifest.media } };
  const bodies = new Map(ctx.bodies);
  const inserts: PublishPlan['inserts'] = [];
  const diff: Diff = { added: [], changed: [], retired: [] };
  const keyFixes: PublishPlan['keyFixes'] = [];
  const inPackage = new Set<string>();

  for (const [kind, field, idOf] of sections) {
    (pkg[field] as (Versioned & Parameters<typeof idOf>[0])[]).forEach((obj, i) => {
      const id = idOf(obj as never);
      const key = objectKey(kind, id);
      const path = `${field}[${i}]`;
      if (inPackage.has(key)) return issue(path, `Duplicate ${kind} ${id} in the package`);
      inPackage.add(key);
      const hash = ctx.hash(obj);
      const revisions = ctx.known.get(key);
      const stored = revisions?.get(obj.revision);
      if (stored !== undefined && stored !== hash) {
        return issue(`${path}.revision`, `${kind} ${id} revision ${obj.revision} already exists with other content; raise the revision`);
      }
      const max = revisions ? Math.max(...revisions.keys()) : 0;
      if (stored === undefined && obj.revision <= max) {
        return issue(`${path}.revision`, `${kind} ${id} revision must be greater than ${max}`);
      }
      const current = manifest.objects[key];
      if (stored === undefined) inserts.push({ kind, id, revision: obj.revision, hash, body: obj });
      if (current?.revision === obj.revision && !current.retired) return; // unchanged
      (current ? diff.changed : diff.added).push(key);
      manifest.objects[key] = { revision: obj.revision };
      bodies.set(key, obj);
      if (kind === 'exercise' && (obj as Exercise).key_fix && max > 0) {
        keyFixes.push({ exercise_id: id, revision: obj.revision });
      }
    });
  }

  pkg.media.forEach((m, i) => {
    const bound = ctx.knownMedia.get(m.media_id);
    if (bound !== undefined && bound !== m.sha256) {
      return issue(`media[${i}].sha256`, `media ${m.media_id} already refers to another file; use a new media_id`);
    }
    if (!ctx.uploadedMedia.has(m.sha256)) {
      return issue(`media[${i}].sha256`, `File ${m.sha256} is not uploaded to bank ${ctx.bankId}; PUT it to /media first`);
    }
    const key = objectKey('media', m.media_id);
    if (manifest.media[m.media_id] === m.sha256) return;
    (manifest.media[m.media_id] ? diff.changed : diff.added).push(key);
    manifest.media[m.media_id] = m.sha256;
  });

  pkg.retire.forEach((r, i) => {
    const key = objectKey(r.kind, r.id);
    const path = `retire[${i}]`;
    if (inPackage.has(key)) return issue(path, `${key} is both published and retired in this package`);
    if (r.kind === 'media') {
      if (!(r.id in manifest.media)) return issue(path, `${key} is not in the bank`);
      delete manifest.media[r.id];
    } else {
      const entry = manifest.objects[key];
      if (!entry || entry.retired) return issue(path, `${key} is not in the bank`);
      if (r.kind === 'exercise') {
        manifest.objects[key] = { revision: entry.revision, retired: true };
      } else {
        delete manifest.objects[key];
        bodies.delete(key);
      }
    }
    diff.retired.push(key);
  });

  // Every reference must resolve in the resulting bank, whether it comes from this package or an older one.
  const has = (kind: ObjectKind, id: string) => objectKey(kind, id) in manifest.objects;
  const where = (key: string) => {
    for (const [kind, field, idOf] of sections) {
      const i = (pkg[field] as unknown[]).findIndex((o) => objectKey(kind, idOf(o as never)) === key);
      if (i >= 0) return `${field}[${i}]`;
    }
    return `bank:${key}`;
  };
  for (const [key, body] of bodies) {
    const entry = manifest.objects[key];
    if (!entry || entry.retired) continue;
    const refs: [string, ObjectKind, string[]][] = [];
    if (key.startsWith('skill:')) refs.push(['topic_ids', 'topic', (body as Skill).topic_ids]);
    if (key.startsWith('knowledge_item:')) refs.push(['skill_ids', 'skill', (body as KnowledgeItem).skill_ids]);
    if (key.startsWith('exercise:')) {
      const ex = body as Exercise;
      if (ex.status === 'retired') continue;
      refs.push(['topic_ids', 'topic', ex.topic_ids]);
      refs.push(['primary_skill_id', 'skill', [ex.primary_skill_id]]);
      refs.push(['secondary_skill_ids', 'skill', ex.secondary_skill_ids]);
      refs.push(['knowledge_item_ids', 'knowledge_item', ex.knowledge_item_ids]);
      if (ex.answer_spec.type === 'gaps') {
        ex.answer_spec.gaps.forEach((g, gi) =>
          refs.push([`answer_spec.gaps[${gi}].knowledge_item_ids`, 'knowledge_item', g.knowledge_item_ids]),
        );
      }
      const media = ex.stimulus?.media?.media_id;
      if (media && !(media in manifest.media)) issue(`${where(key)}.stimulus.media.media_id`, `Unknown media ${media}`);
    }
    for (const [field, kind, ids] of refs) {
      for (const id of ids) if (!has(kind, id)) issue(`${where(key)}.${field}`, `Unknown or retired ${kind} ${id}`);
    }
  }

  if (issues.length === 0 && inserts.length === 0 && diff.added.length + diff.changed.length + diff.retired.length === 0) {
    issue('', 'The package changes nothing in the bank');
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, plan: { manifest, inserts, diff, keyFixes } };
}

const byKey = <T>(idOf: (o: T) => string) => (a: T, b: T) => (idOf(a) < idOf(b) ? -1 : 1);

/** The learner's view of a bank version: drafts are left out, retired exercises stay for history. */
export function buildSnapshot(input: {
  bankId: string;
  version: number;
  createdAt: string;
  manifest: BankManifest;
  bodies: Map<string, unknown>;
  media: Map<string, Omit<MediaInfo, 'media_id' | 'sha256'>>;
}): BankSnapshot {
  const pick = <T>(prefix: string) =>
    Object.entries(input.manifest.objects)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, entry]) => {
        const body = input.bodies.get(k) as T;
        return entry.retired ? { ...body, status: 'retired' as const } : body;
      });
  return {
    schema_version: SCHEMA_VERSION,
    bank_id: input.bankId,
    version: input.version,
    created_at: input.createdAt,
    topics: pick<Topic>('topic:').sort(byKey((t) => t.topic_id)),
    skills: pick<Skill>('skill:').sort(byKey((s) => s.skill_id)),
    knowledge_items: pick<KnowledgeItem>('knowledge_item:').sort(byKey((k) => k.item_id)),
    exercises: pick<Exercise>('exercise:')
      .filter((e) => e.status === 'published' || e.status === 'retired')
      .sort(byKey((e) => e.exercise_id)),
    media: Object.entries(input.manifest.media)
      .map(([media_id, sha256]) => ({ media_id, sha256, ...input.media.get(sha256)! }))
      .sort(byKey((m) => m.media_id)),
  };
}

/** Applies a package to an empty bank: the demo build and tests use it to get a snapshot without a server. */
export function snapshotFromPackage(
  pkg: ContentPackage,
  media: Map<string, Omit<MediaInfo, 'media_id' | 'sha256'>>,
): BankSnapshot {
  const result = planPublication(pkg, {
    bankId: pkg.bank_id,
    audience: pkg.audience,
    manifest: EMPTY_MANIFEST,
    bodies: new Map(),
    known: new Map(),
    knownMedia: new Map(),
    uploadedMedia: new Set(media.keys()),
    hash: stableStringify,
  });
  if (!result.ok) throw new Error(`Invalid package: ${result.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  const bodies = new Map(result.plan.inserts.map((o) => [objectKey(o.kind, o.id), o.body]));
  return buildSnapshot({
    bankId: pkg.bank_id,
    version: pkg.package_version,
    createdAt: pkg.created_at,
    manifest: result.plan.manifest,
    bodies,
    media,
  });
}
