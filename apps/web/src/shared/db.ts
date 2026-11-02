import Dexie, { type Table } from 'dexie';
import type {
  AttemptResult,
  BankHead,
  BankSnapshot,
  BankVersionInfo,
  LearnerEvent,
  PlanItem,
  RecommendationSet,
  SchedulerConfig,
  SessionFilter,
  SessionMode,
} from '@de-trainer/core';

/** An event as kept on the device: synced 0 = in the outbox, 1 = on the server, 2 = refused by validation (kept locally). */
export type LocalEvent = LearnerEvent & { seq?: number; synced: 0 | 1 | 2 };

export type ActiveSession = {
  session_id: string;
  bank_id: string;
  /** The session keeps the bank version it started with: an update never changes a question mid-session. */
  bank_version: number;
  mode: SessionMode;
  filter?: SessionFilter;
  queue: PlanItem[];
  /** Index of the next unanswered item. */
  index: number;
  retries: number;
  results: AttemptResult[];
  started_at: string;
};

export type SyncState = {
  state: 'idle' | 'syncing' | 'ok' | 'offline' | 'auth' | 'error';
  message?: string;
  last_ok_at?: string;
};

export type Profile = {
  user_id: string;
  display_name: string;
  email?: string;
  logout_url?: string;
  banks: { bank_id: string; title: string; role: string }[];
};

/** Typed key-value store for everything that is not an event or a snapshot. */
export type KvMap = {
  profile: Profile;
  device_id: string;
  last_seq: number;
  /** Bank versions available on the server, from the last pull. */
  heads: BankHead[];
  /** Bank version in use on this device, per bank. */
  current: Record<string, number>;
  /** Newest downloaded version, applied when no session is running. */
  downloaded: Record<string, number>;
  selected_bank: string;
  active_session: ActiveSession | null;
  recommendations: { version: number; set: RecommendationSet | null };
  scheduler_config: { version: number; config: SchedulerConfig };
  sync: SyncState;
  [key: `versions:${string}`]: BankVersionInfo[];
  [key: `seen_version:${string}`]: number;
};

export class LocalDb extends Dexie {
  events!: Table<LocalEvent, string>;
  kv!: Table<{ key: string; value: unknown }, string>;
  snapshots!: Table<{ key: string; bank_id: string; version: number; snapshot: BankSnapshot }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ events: 'event_id, synced, seq, type', kv: 'key', snapshots: 'key, bank_id' });
  }

  async get<K extends keyof KvMap>(key: K): Promise<KvMap[K] | undefined> {
    return (await this.kv.get(key as string))?.value as KvMap[K] | undefined;
  }

  async put<K extends keyof KvMap>(key: K, value: KvMap[K]): Promise<void> {
    await this.kv.put({ key: key as string, value });
  }
}

export const snapshotKey = (bankId: string, version: number) => `${bankId}@${version}`;

/**
 * Moves each bank to its newest downloaded version unless a session is running,
 * then drops snapshots nobody needs any more.
 */
export async function applyDownloadedSnapshots(db: LocalDb) {
  await db.transaction('rw', db.kv, db.snapshots, async () => {
    const active = await db.get('active_session');
    if (active) return;
    const downloaded = (await db.get('downloaded')) ?? {};
    const current = { ...((await db.get('current')) ?? {}), ...downloaded };
    await db.put('current', current);
    const keep = new Set(Object.entries(current).map(([b, v]) => snapshotKey(b, v)));
    const stale = (await db.snapshots.toCollection().primaryKeys()).filter((k) => !keep.has(k));
    await db.snapshots.bulkDelete(stale);
  });
}
