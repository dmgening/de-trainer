import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { and, asc, desc, eq, max } from 'drizzle-orm';
import {
  ContentPackage,
  EMPTY_MANIFEST,
  LIMITS,
  buildSnapshot,
  objectKey,
  planPublication,
  stableStringify,
  uuidv7,
  type BankManifest,
  type BankVersionInfo,
  type Diff,
  type MediaInfo,
  type PublishIssue,
  type PublishResponse,
} from '@de-trainer/core';
import type { Db } from '../db/client';
import { bankHeads, bankMembers, bankVersions, banks, contentObjects, events, media } from '../db/schema';
import { sniffImage } from './image';

export const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
export const contentHash = (body: unknown) => sha256(stableStringify(body));

/** A refusal Nomir can act on: status, machine code, message and field-level issues. */
export class ContentError extends Error {
  constructor(
    readonly status: 404 | 409 | 413 | 415 | 422,
    readonly code: string,
    message: string,
    readonly issues?: PublishIssue[],
  ) {
    super(message);
  }
}

type MediaMeta = Omit<MediaInfo, 'media_id' | 'sha256'>;

export function zodIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): PublishIssue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }));
}

export function createContentService(db: Db, dataDir: string) {
  const mediaDir = path.join(dataDir, 'media');
  const snapshots = new Map<string, string>();

  const bank = (bankId: string) => db.select().from(banks).where(eq(banks.bankId, bankId)).get();
  const head = (bankId: string) => db.select().from(bankHeads).where(eq(bankHeads.bankId, bankId)).get()?.version ?? null;
  const versionRow = (bankId: string, version: number) =>
    db.select().from(bankVersions).where(and(eq(bankVersions.bankId, bankId), eq(bankVersions.version, version))).get();
  const manifestOf = (bankId: string, version: number | null): BankManifest => {
    const row = version === null ? undefined : versionRow(bankId, version);
    return row ? (JSON.parse(row.manifest) as BankManifest) : EMPTY_MANIFEST;
  };

  function requireBank(bankId: string) {
    const b = bank(bankId);
    if (!b) throw new ContentError(404, 'not_found', `Unknown bank ${bankId}`);
    return b;
  }

  /** Bodies of the revisions a manifest lists. */
  function bodiesFor(bankId: string, manifest: BankManifest) {
    const rows = db
      .select({ kind: contentObjects.kind, id: contentObjects.objectId, revision: contentObjects.revision, body: contentObjects.body })
      .from(contentObjects)
      .where(eq(contentObjects.bankId, bankId))
      .all();
    const bodies = new Map<string, unknown>();
    for (const r of rows) {
      const key = objectKey(r.kind, r.id);
      if (manifest.objects[key]?.revision === r.revision) bodies.set(key, JSON.parse(r.body));
    }
    return bodies;
  }

  function mediaMeta(bankId: string) {
    return new Map<string, MediaMeta>(
      db
        .select()
        .from(media)
        .where(eq(media.bankId, bankId))
        .all()
        .map((m) => [m.sha256, { mime: m.mime as MediaMeta['mime'], bytes: m.bytes, width: m.width, height: m.height }]),
    );
  }

  function plan(bankId: string, raw: unknown) {
    const b = requireBank(bankId);
    const parsed = ContentPackage.safeParse(raw);
    if (!parsed.success) throw new ContentError(422, 'invalid_package', 'Package does not match the schema', zodIssues(parsed.error));
    const pkg = parsed.data;
    const current = head(bankId);
    const manifest = manifestOf(bankId, current);
    const known = new Map<string, Map<number, string>>();
    for (const r of db
      .select({ kind: contentObjects.kind, id: contentObjects.objectId, revision: contentObjects.revision, hash: contentObjects.contentHash })
      .from(contentObjects)
      .where(eq(contentObjects.bankId, bankId))
      .all()) {
      const key = objectKey(r.kind, r.id);
      if (!known.has(key)) known.set(key, new Map());
      known.get(key)!.set(r.revision, r.hash);
    }
    const knownMedia = new Map<string, string>();
    for (const v of db.select({ manifest: bankVersions.manifest }).from(bankVersions).where(eq(bankVersions.bankId, bankId)).all()) {
      for (const [id, sha] of Object.entries((JSON.parse(v.manifest) as BankManifest).media)) knownMedia.set(id, sha);
    }
    const result = planPublication(pkg, {
      bankId,
      audience: b.audience,
      manifest,
      bodies: bodiesFor(bankId, manifest),
      known,
      knownMedia,
      uploadedMedia: new Set(mediaMeta(bankId).keys()),
      hash: contentHash,
    });
    if (!result.ok) throw new ContentError(422, 'invalid_package', `Package rejected: ${result.issues.length} problem(s)`, result.issues);
    return { pkg, plan: result.plan, current };
  }

  function existingPublication(bankId: string, pkg: ContentPackage) {
    return db
      .select()
      .from(bankVersions)
      .where(and(eq(bankVersions.bankId, bankId), eq(bankVersions.packageId, pkg.package_id), eq(bankVersions.packageVersion, pkg.package_version)))
      .get();
  }

  /** Idempotent replay first: the same package_id/version answers with the version it created. */
  function replay(bankId: string, raw: unknown): PublishResponse | null {
    const parsed = ContentPackage.safeParse(raw);
    if (!parsed.success) return null;
    const prev = existingPublication(bankId, parsed.data);
    if (!prev) return null;
    if (prev.contentHash !== contentHash(parsed.data)) {
      throw new ContentError(409, 'package_conflict', `Package ${parsed.data.package_id} v${parsed.data.package_version} was already published with other content; raise package_version`);
    }
    return { bank_id: bankId, version: prev.version, status: 'unchanged', diff: JSON.parse(prev.diff) as Diff };
  }

  function nextVersion(bankId: string) {
    return (db.select({ v: max(bankVersions.version) }).from(bankVersions).where(eq(bankVersions.bankId, bankId)).get()?.v ?? 0) + 1;
  }

  function writeVersion(bankId: string, input: { kind: 'publish' | 'rollback'; manifest: BankManifest; diff: Diff; changelog: string; actor: string; packageId?: string; packageVersion?: number; rollbackTo?: number; contentHash?: string }) {
    const version = nextVersion(bankId);
    db.insert(bankVersions)
      .values({
        bankId,
        version,
        kind: input.kind,
        packageId: input.packageId ?? null,
        packageVersion: input.packageVersion ?? null,
        rollbackTo: input.rollbackTo ?? null,
        contentHash: input.contentHash ?? null,
        changelog: input.changelog,
        manifest: JSON.stringify(input.manifest),
        diff: JSON.stringify(input.diff),
        createdBy: input.actor,
        createdAt: new Date().toISOString(),
      })
      .run();
    db.insert(bankHeads).values({ bankId, version }).onConflictDoUpdate({ target: bankHeads.bankId, set: { version } }).run();
    return version;
  }

  return {
    head,
    requireBank,

    validate(bankId: string, raw: unknown): PublishResponse {
      const done = replay(bankId, raw);
      if (done) return done;
      const { plan: p, current } = plan(bankId, raw);
      return { bank_id: bankId, version: (current ?? 0) + 1, status: 'valid', diff: p.diff };
    },

    /** Validates, then writes the whole package in one transaction or nothing at all. */
    publish(bankId: string, raw: unknown, actor: string): PublishResponse {
      const done = replay(bankId, raw);
      if (done) return done;
      const { pkg, plan: p } = plan(bankId, raw);
      const version = db.transaction(() => {
        const v = writeVersion(bankId, {
          kind: 'publish',
          manifest: p.manifest,
          diff: p.diff,
          changelog: pkg.changelog,
          actor,
          packageId: pkg.package_id,
          packageVersion: pkg.package_version,
          contentHash: contentHash(pkg),
        });
        for (const o of p.inserts) {
          db.insert(contentObjects)
            .values({ bankId, kind: o.kind, objectId: o.id, revision: o.revision, body: JSON.stringify(o.body), contentHash: o.hash, createdVersion: v })
            .run();
        }
        // A corrected key: earlier attempts stop counting for every learner of the bank. The log itself is untouched.
        if (p.keyFixes.length > 0) {
          const members = db.select({ userId: bankMembers.userId }).from(bankMembers).where(eq(bankMembers.bankId, bankId)).all();
          const now = new Date().toISOString();
          for (const { userId } of members) {
            for (const fix of p.keyFixes) {
              const eventId = uuidv7();
              db.insert(events)
                .values({
                  eventId,
                  userId,
                  deviceId: 'server',
                  type: 'attempts_invalidated',
                  actor,
                  clientTs: now,
                  serverReceivedAt: now,
                  clockSuspect: false,
                  payload: JSON.stringify({ bank_id: bankId, exercise_id: fix.exercise_id, revisions_below: fix.revision, reason: `key_fix in ${pkg.package_id} v${pkg.package_version}` }),
                })
                .run();
            }
          }
        }
        return v;
      });
      return { bank_id: bankId, version, status: 'published', diff: p.diff };
    },

    /** Rollback is a new version with an older manifest: history stays linear, nothing is deleted. */
    rollback(bankId: string, toVersion: number, actor: string): PublishResponse {
      requireBank(bankId);
      const target = versionRow(bankId, toVersion);
      if (!target) throw new ContentError(404, 'not_found', `Bank ${bankId} has no version ${toVersion}`);
      const current = head(bankId)!;
      if (current === toVersion) throw new ContentError(422, 'already_current', `Version ${toVersion} is already current`);
      const from = manifestOf(bankId, current);
      const to = JSON.parse(target.manifest) as BankManifest;
      const diff: Diff = { added: [], changed: [], retired: [] };
      const flat = (m: BankManifest) =>
        new Map<string, string>([
          ...Object.entries(m.objects).map(([k, v]) => [k, `${v.revision}${v.retired ? 'r' : ''}`] as const),
          ...Object.entries(m.media).map(([k, v]) => [`media:${k}`, v] as const),
        ]);
      const a = flat(from);
      const b = flat(to);
      for (const [k, v] of b) if (!a.has(k)) diff.added.push(k);
      else if (a.get(k) !== v) diff.changed.push(k);
      for (const k of a.keys()) if (!b.has(k)) diff.retired.push(k);
      const version = db.transaction(() =>
        writeVersion(bankId, { kind: 'rollback', manifest: to, diff, changelog: `Откат к версии ${toVersion}`, actor, rollbackTo: toVersion }),
      );
      return { bank_id: bankId, version, status: 'published', diff };
    },

    /** Learner snapshot of a version as JSON text; versions are immutable, so the text is cached. */
    snapshot(bankId: string, version: number): string | null {
      const key = `${bankId}@${version}`;
      const cached = snapshots.get(key);
      if (cached) return cached;
      const row = versionRow(bankId, version);
      if (!row) return null;
      const manifest = JSON.parse(row.manifest) as BankManifest;
      const json = JSON.stringify(
        buildSnapshot({ bankId, version, createdAt: row.createdAt, manifest, bodies: bodiesFor(bankId, manifest), media: mediaMeta(bankId) }),
      );
      if (snapshots.size > 20) snapshots.delete(snapshots.keys().next().value!);
      snapshots.set(key, json);
      return json;
    },

    /** Everything in the current version, drafts included: what Nomir works from. */
    current(bankId: string) {
      const b = requireBank(bankId);
      const v = head(bankId);
      const manifest = manifestOf(bankId, v);
      const bodies = bodiesFor(bankId, manifest);
      const group = (prefix: string) => Object.keys(manifest.objects).filter((k) => k.startsWith(prefix)).sort().map((k) => ({ ...(bodies.get(k) as object), ...(manifest.objects[k]!.retired ? { status: 'retired' } : {}) }));
      return {
        bank_id: bankId,
        title: b.title,
        audience: b.audience,
        head: v,
        topics: group('topic:'),
        skills: group('skill:'),
        knowledge_items: group('knowledge_item:'),
        exercises: group('exercise:'),
        media: Object.entries(manifest.media).map(([media_id, sha]) => ({ media_id, sha256: sha, ...mediaMeta(bankId).get(sha) })),
      };
    },

    versions(bankId: string): BankVersionInfo[] {
      return db
        .select()
        .from(bankVersions)
        .where(eq(bankVersions.bankId, bankId))
        .orderBy(desc(bankVersions.version))
        .all()
        .map((v) => ({
          version: v.version,
          kind: v.kind,
          package_id: v.packageId,
          package_version: v.packageVersion,
          rollback_to: v.rollbackTo,
          changelog: v.changelog,
          diff: JSON.parse(v.diff) as Diff,
          created_by: v.createdBy,
          created_at: v.createdAt,
        }));
    },

    /** Stores an image by its hash after checking the bytes: raster only, size and dimensions capped. */
    putMedia(bankId: string, sha: string, body: Buffer) {
      requireBank(bankId);
      if (body.length > LIMITS.mediaBytes) throw new ContentError(413, 'too_large', `Images are limited to ${LIMITS.mediaBytes} bytes`);
      if (sha256(body) !== sha) throw new ContentError(422, 'hash_mismatch', 'The body does not match the sha256 in the URL');
      const info = sniffImage(body);
      if (!info) throw new ContentError(415, 'unsupported_media', 'Only JPEG, PNG and WebP images are accepted');
      if (info.width > LIMITS.mediaPixels || info.height > LIMITS.mediaPixels || info.width < 1 || info.height < 1) {
        throw new ContentError(422, 'bad_dimensions', `Images must be at most ${LIMITS.mediaPixels}px per side`);
      }
      mkdirSync(mediaDir, { recursive: true });
      const file = path.join(mediaDir, sha);
      if (!existsSync(file)) {
        const tmp = `${file}.${process.pid}.tmp`;
        writeFileSync(tmp, body);
        renameSync(tmp, file);
      }
      db.insert(media)
        .values({ bankId, sha256: sha, mime: info.mime, bytes: body.length, width: info.width, height: info.height, createdAt: new Date().toISOString() })
        .onConflictDoNothing()
        .run();
      return { sha256: sha, ...info, bytes: body.length };
    },

    /** A file only reaches users who belong to a bank holding it. */
    mediaForUser(userId: string, sha: string) {
      const row = db
        .select({ mime: media.mime })
        .from(media)
        .innerJoin(bankMembers, eq(bankMembers.bankId, media.bankId))
        .where(and(eq(media.sha256, sha), eq(bankMembers.userId, userId)))
        .orderBy(asc(media.bankId))
        .get();
      return row ? { mime: row.mime, file: path.join(mediaDir, sha) } : undefined;
    },
  };
}

export type ContentService = ReturnType<typeof createContentService>;
