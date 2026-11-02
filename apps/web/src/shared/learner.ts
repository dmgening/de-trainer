import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import {
  DEFAULT_SCHEDULER_CONFIG,
  activeRecommendations,
  deriveState,
  type BankSnapshot,
  type LearnerEvent,
  type LearnerState,
  type Recommendation,
  type SchedulerConfig,
} from '@de-trainer/core';
import { useBackend } from './backend';
import { snapshotKey, type ActiveSession, type KvMap } from './db';

export function useKv<K extends keyof KvMap>(key: K): KvMap[K] | undefined {
  const { db } = useBackend();
  return useLiveQuery(() => db.get(key), [db, key]);
}

export type Learner = {
  loading: boolean;
  bankId: string | null;
  bank: BankSnapshot | null;
  events: LearnerEvent[];
  state: LearnerState | null;
  config: SchedulerConfig;
  recommendations: Recommendation[];
  active: ActiveSession | null;
  pending: number;
};

/** Everything the screens need, derived from the local database and recomputed when it changes. */
export function useLearner(): Learner {
  const { db } = useBackend();
  const data = useLiveQuery(async () => {
    const [events, current, selected, active, recs, cfg, pending] = await Promise.all([
      db.events.toArray(),
      db.get('current'),
      db.get('selected_bank'),
      db.get('active_session'),
      db.get('recommendations'),
      db.get('scheduler_config'),
      db.events.where('synced').equals(0).count(),
    ]);
    const banks = Object.keys(current ?? {});
    const bankId = selected && banks.includes(selected) ? selected : (banks[0] ?? null);
    const version = bankId ? current![bankId] : undefined;
    const snap = bankId && version ? await db.snapshots.get(snapshotKey(bankId, version)) : undefined;
    return { events, bankId, bank: snap?.snapshot ?? null, active: active ?? null, recs, cfg, pending };
  }, [db]);

  const config = data?.cfg?.config ?? DEFAULT_SCHEDULER_CONFIG;
  const events = data?.events;
  const bankId = data?.bankId;
  const recs = data?.recs;
  const state = useMemo(() => (bankId && events ? deriveState(events, { bank_id: bankId, config }) : null), [events, bankId, config]);
  // Expired priorities stop applying offline too; the fallback rule takes over (PRD §11.2).
  const recommendations = useMemo(() => activeRecommendations(recs?.set, new Date()), [recs]);

  return {
    loading: data === undefined,
    bankId: data?.bankId ?? null,
    bank: data?.bank ?? null,
    events: data?.events ?? [],
    state,
    config,
    recommendations,
    active: data?.active ?? null,
    pending: data?.pending ?? 0,
  };
}

/** The bank version an active session is pinned to. */
export function useSessionBank(active: ActiveSession | null): BankSnapshot | null | undefined {
  const { db } = useBackend();
  return useLiveQuery(
    async () => (active ? ((await db.snapshots.get(snapshotKey(active.bank_id, active.bank_version)))?.snapshot ?? null) : null),
    [db, active?.bank_id, active?.bank_version],
  );
}
