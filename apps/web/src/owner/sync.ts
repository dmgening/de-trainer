import { ClientEvent, type LearnerEvent } from '@de-trainer/core';
import { applyDownloadedSnapshots, snapshotKey, type LocalDb, type LocalEvent } from '../shared/db';
import { ApiFailure, api, mediaPath } from './api';

const PUSH_BATCH = 200;

const toEvent = ({ synced, seq, ...event }: LocalEvent) => event;

export const mediaCacheName = (userId: string) => `owner-media:${userId}`;

/**
 * One sync round (PRD §11.2): push the outbox, pull new events, priorities and config,
 * download new bank versions with their images. Events only ever get added, so devices merge by event_id.
 */
export async function syncOnce(db: LocalDb, userId: string): Promise<void> {
  // 1. Push. Events the server would never accept are set aside instead of blocking the queue forever.
  for (;;) {
    const pending = await db.events.where('synced').equals(0).limit(PUSH_BATCH).toArray();
    if (pending.length === 0) break;
    const valid: LocalEvent[] = [];
    for (const e of pending) {
      if (ClientEvent.safeParse(toEvent(e)).success) valid.push(e);
      else await db.events.update(e.event_id, { synced: 2 });
    }
    if (valid.length === 0) continue;
    await api.push(valid.map((e) => toEvent(e) as ClientEvent));
    await db.events.bulkUpdate(valid.map((e) => ({ key: e.event_id, changes: { synced: 1 as const } })));
  }

  // 2. Pull everything after the cursor, page by page.
  let since = (await db.get('last_seq')) ?? 0;
  let pull;
  do {
    pull = await api.pull(since);
    const events = pull.events as (LearnerEvent & { seq: number })[];
    await db.transaction('rw', db.events, db.kv, async () => {
      if (events.length) {
        const known = new Set(await db.events.where('event_id').anyOf(events.map((e) => e.event_id)).primaryKeys());
        await db.events.bulkPut(events.filter((e) => !known.has(e.event_id)).map((e) => ({ ...e, synced: 1 as const })));
        for (const e of events.filter((x) => known.has(x.event_id))) await db.events.update(e.event_id, { seq: e.seq });
      }
      since = pull!.max_seq;
      await db.put('last_seq', since);
      await db.put('heads', pull!.banks);
      await db.put('recommendations', pull!.recommendations);
      await db.put('scheduler_config', pull!.scheduler_config);
    });
  } while (pull.has_more);

  // 3. New bank versions: snapshot first, then the images it needs, then make it available.
  const profile = await db.get('profile');
  if (profile) await db.put('profile', { ...profile, banks: pull.banks.map((b) => ({ bank_id: b.bank_id, title: b.title, role: b.role })) });
  const cache = await caches.open(mediaCacheName(userId));
  for (const head of pull.banks) {
    if (head.version === null) continue;
    const key = snapshotKey(head.bank_id, head.version);
    if (!(await db.snapshots.get(key))) {
      const snapshot = await api.snapshot(head.bank_id, head.version);
      for (const m of snapshot.media) {
        if (await cache.match(mediaPath(m.sha256))) continue;
        try {
          await cache.put(mediaPath(m.sha256), await api.media(m.sha256));
        } catch (err) {
          // A missing image must not block the bank: the question shows its alt text instead.
          if (err instanceof ApiFailure && err.kind !== 'error') throw err;
        }
      }
      await db.snapshots.put({ key, bank_id: head.bank_id, version: head.version, snapshot });
    }
    await db.put('downloaded', { ...((await db.get('downloaded')) ?? {}), [head.bank_id]: head.version });
    await db.put(`versions:${head.bank_id}`, (await api.versions(head.bank_id)).versions);
  }
  await applyDownloadedSnapshots(db);
}

/** Runs sync on start, on reconnect, when the app comes back to the foreground, after local writes and every few minutes. */
export function startSync(db: LocalDb, userId: string) {
  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const run = async () => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      const prev = await db.get('sync');
      await db.put('sync', { ...prev, state: 'syncing' });
      try {
        await syncOnce(db, userId);
        await db.put('sync', { state: 'ok', last_ok_at: new Date().toISOString() });
      } catch (err) {
        const kind = err instanceof ApiFailure ? err.kind : 'error';
        const state = kind === 'offline' ? 'offline' : kind === 'auth' || kind === 'forbidden' ? 'auth' : 'error';
        await db.put('sync', { state, message: err instanceof Error ? err.message : String(err), last_ok_at: prev?.last_ok_at });
      } finally {
        running = null;
      }
    })();
    await running;
    if (again) {
      again = false;
      await run();
    }
  };

  const soon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 1500);
  };
  const onVisible = () => document.visibilityState === 'visible' && void run();
  const onOnline = () => void run();
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => navigator.onLine && void run(), 5 * 60_000);
  void run();

  return {
    now: run,
    soon,
    stop() {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    },
  };
}
