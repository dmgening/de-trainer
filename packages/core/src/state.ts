import type { Exercise } from './content';
import { compareEvents, type AttemptResult, type EventOf, type LearnerEvent } from './events';
import { addDays } from './primitives';
import { SCHEDULER_VERSION, type SchedulerConfig } from './scheduler-config';

export type UnitKind = 'skill' | 'item';
export type UnitStatus = 'no_data' | 'learning' | 'needs_practice' | 'consolidating' | 'stable';
type Graded = 'correct' | 'near_miss' | 'wrong';

/** Spaced-repetition state of one skill or knowledge item. Derived data: never stored as truth. */
export type UnitState = {
  kind: UnitKind;
  id: string;
  /** Rung on the interval ladder; 0 = nothing consolidated yet. */
  step: number;
  /** Local date from which the unit is due for delayed review. */
  due_date: string | null;
  /** Graded observations (skips excluded). */
  attempts: number;
  independent_successes: number;
  errors: number;
  last_seen_at: string | null;
  last_error_at: string | null;
  recent: Graded[];
  success_days: string[];
  success_exercises: string[];
  status: UnitStatus;
};

export type LearnerState = {
  scheduler_version: number;
  bank_id: string;
  units: Record<string, UnitState>;
  /** Exercises flagged as disputed and not yet resolved by Nomir: hidden from sessions. */
  flagged: Record<string, { flag_id: string; revision: number; at: string }>;
  exercise_last_seen: Record<string, string>;
  family_last_seen: Record<string, string>;
  invalidated_attempts: number;
};

export const unitKey = (kind: UnitKind, id: string) => `${kind}:${id}`;

/** Units an exercise is graded on: its primary skill and its knowledge items, including per-gap items. */
export function exerciseUnits(ex: Pick<Exercise, 'primary_skill_id' | 'knowledge_item_ids' | 'answer_spec'>): string[] {
  const keys = new Set([unitKey('skill', ex.primary_skill_id), ...ex.knowledge_item_ids.map((i) => unitKey('item', i))]);
  if (ex.answer_spec.type === 'gaps') {
    for (const g of ex.answer_spec.gaps) for (const i of g.knowledge_item_ids) keys.add(unitKey('item', i));
  }
  return [...keys];
}

/** Per-gap knowledge items, copied into attempts so they can be graded part by part. */
export function partItems(ex: Pick<Exercise, 'answer_spec'>): Record<string, string[]> | undefined {
  if (ex.answer_spec.type !== 'gaps') return undefined;
  const out: Record<string, string[]> = {};
  for (const g of ex.answer_spec.gaps) if (g.knowledge_item_ids.length) out[g.id] = g.knowledge_item_ids;
  return Object.keys(out).length ? out : undefined;
}

type Internal = UnitState & { upSession?: string; downSession?: string };

function newUnit(kind: UnitKind, id: string): Internal {
  return {
    kind,
    id,
    step: 0,
    due_date: null,
    attempts: 0,
    independent_successes: 0,
    errors: 0,
    last_seen_at: null,
    last_error_at: null,
    recent: [],
    success_days: [],
    success_exercises: [],
    status: 'no_data',
  };
}

function pushCapped(list: string[], value: string, cap = 30) {
  if (!list.includes(value)) {
    list.push(value);
    if (list.length > cap) list.shift();
  }
}

function apply(u: Internal, outcome: AttemptResult, a: EventOf<'attempt'>['payload'], config: SchedulerConfig) {
  u.last_seen_at = a.answered_at;
  if (outcome === 'skipped') return;
  // Showing the answer means the learner did not know it.
  const graded: Graded = outcome === 'revealed' ? 'wrong' : outcome;
  u.attempts++;
  u.recent.push(graded);
  if (u.recent.length > 5) u.recent.shift();
  if (graded === 'wrong') {
    u.errors++;
    u.last_error_at = a.answered_at;
  }
  const independent = outcome === 'correct' && a.hints_used === 0 && !a.retry;
  if (independent) {
    u.independent_successes++;
    pushCapped(u.success_days, a.local_date);
    pushCapped(u.success_exercises, a.exercise_id);
  }
  // Only delayed review in a recommended session moves the ladder; free practice and in-session repeats don't.
  if (a.mode !== 'recommended' || a.retry) return;
  const ladder = config.ladder_days;
  if (independent) {
    if (u.upSession === a.session_id) return;
    if (u.step === 0) {
      u.step = 1;
    } else if (u.due_date !== null && a.local_date >= u.due_date) {
      u.step = Math.min(u.step + 1, ladder.length);
    } else {
      return; // early success: keep the schedule
    }
    u.due_date = addDays(a.local_date, ladder[u.step - 1]!);
    u.upSession = a.session_id;
  } else if (graded === 'wrong') {
    if (u.downSession !== a.session_id) {
      u.step = Math.max(0, u.step - 1);
      u.downSession = a.session_id;
    }
    u.due_date = addDays(a.local_date, ladder[0]!);
  }
}

function status(u: UnitState, config: SchedulerConfig): UnitStatus {
  if (u.attempts === 0) return 'no_data';
  if (u.recent.slice(-2).includes('wrong')) return 'needs_practice';
  const s = config.stable;
  if (u.step >= s.min_step && u.success_days.length >= s.min_days && u.success_exercises.length >= s.min_exercises) {
    return 'stable';
  }
  return u.step >= 2 ? 'consolidating' : 'learning';
}

/**
 * Folds the event log of one bank into learner state. Pure and order-independent:
 * events are sorted by (client_ts, event_id), so every device and the server get the same result.
 */
export function deriveState(events: readonly LearnerEvent[], opts: { bank_id: string; config: SchedulerConfig }): LearnerState {
  const { bank_id, config } = opts;
  const invalidBelow = new Map<string, number>();
  for (const e of events) {
    if (e.type === 'attempts_invalidated' && e.payload.bank_id === bank_id) {
      const prev = invalidBelow.get(e.payload.exercise_id) ?? 0;
      invalidBelow.set(e.payload.exercise_id, Math.max(prev, e.payload.revisions_below));
    }
  }

  const units = new Map<string, Internal>();
  const unit = (kind: UnitKind, id: string) => {
    const key = unitKey(kind, id);
    let u = units.get(key);
    if (!u) units.set(key, (u = newUnit(kind, id)));
    return u;
  };
  const state: LearnerState = {
    scheduler_version: SCHEDULER_VERSION,
    bank_id,
    units: {},
    flagged: {},
    exercise_last_seen: {},
    family_last_seen: {},
    invalidated_attempts: 0,
  };

  for (const e of [...events].sort(compareEvents)) {
    if (e.type === 'attempt') {
      const a = e.payload;
      if (a.bank_id !== bank_id) continue;
      state.exercise_last_seen[a.exercise_id] = a.answered_at;
      state.family_last_seen[a.family_id] = a.answered_at;
      if (a.exercise_revision < (invalidBelow.get(a.exercise_id) ?? 0)) {
        state.invalidated_attempts++;
        continue;
      }
      const partOutcome = new Map((a.parts ?? []).map((p) => [p.id, p.outcome]));
      const inParts = new Set(Object.values(a.part_items ?? {}).flat());
      apply(unit('skill', a.primary_skill_id), a.result, a, config);
      for (const item of a.knowledge_item_ids) if (!inParts.has(item)) apply(unit('item', item), a.result, a, config);
      for (const [gapId, items] of Object.entries(a.part_items ?? {})) {
        // Skips and reveals have no per-gap result: the whole attempt's result applies.
        const outcome = partOutcome.get(gapId) ?? a.result;
        for (const item of items) apply(unit('item', item), outcome, a, config);
      }
    } else if (e.type === 'exercise_flagged' && e.payload.bank_id === bank_id) {
      state.flagged[e.payload.exercise_id] = { flag_id: e.payload.flag_id, revision: e.payload.revision, at: e.client_ts };
    } else if (e.type === 'flag_resolved' && e.payload.bank_id === bank_id) {
      delete state.flagged[e.payload.exercise_id];
    }
  }

  for (const [key, u] of units) {
    const { upSession, downSession, ...pub } = u;
    pub.status = status(pub, config);
    state.units[key] = pub;
  }
  return state;
}

export type SessionRecord = {
  session_id: string;
  bank_id: string;
  mode: 'recommended' | 'practice';
  started_at: string;
  finished_at: string | null;
  abandoned: boolean;
  planned: number;
  attempts: EventOf<'attempt'>[];
  counts: Record<AttemptResult, number> & { independent: number };
};

/** Sessions with their attempts, newest first: the history screen and the export summary. */
export function sessionHistory(events: readonly LearnerEvent[]): SessionRecord[] {
  const sessions = new Map<string, SessionRecord>();
  const empty = () => ({ correct: 0, near_miss: 0, wrong: 0, skipped: 0, revealed: 0, independent: 0 });
  for (const e of [...events].sort(compareEvents)) {
    if (e.type === 'session_started') {
      sessions.set(e.payload.session_id, {
        session_id: e.payload.session_id,
        bank_id: e.payload.bank_id,
        mode: e.payload.mode,
        started_at: e.client_ts,
        finished_at: null,
        abandoned: false,
        planned: e.payload.plan.length,
        attempts: [],
        counts: empty(),
      });
    } else if (e.type === 'attempt') {
      const s = sessions.get(e.payload.session_id);
      if (!s) continue;
      s.attempts.push(e);
      s.counts[e.payload.result]++;
      if (e.payload.result === 'correct' && e.payload.hints_used === 0 && !e.payload.retry) s.counts.independent++;
    } else if (e.type === 'session_finished') {
      const s = sessions.get(e.payload.session_id);
      if (!s) continue;
      s.finished_at = e.client_ts;
      s.abandoned = e.payload.abandoned;
    }
  }
  return [...sessions.values()].reverse();
}

/** Compact summary reproducible from the log alone (export, acceptance A07). */
export function summarize(events: readonly LearnerEvent[], opts: { bank_id: string; config: SchedulerConfig }) {
  const state = deriveState(events, opts);
  const byStatus: Record<UnitStatus, number> = { no_data: 0, learning: 0, needs_practice: 0, consolidating: 0, stable: 0 };
  for (const u of Object.values(state.units)) byStatus[u.status]++;
  const sessions = sessionHistory(events).filter((s) => s.bank_id === opts.bank_id);
  return {
    bank_id: opts.bank_id,
    scheduler_version: state.scheduler_version,
    sessions: sessions.length,
    attempts: sessions.reduce((n, s) => n + s.attempts.length, 0),
    independent_correct: sessions.reduce((n, s) => n + s.counts.independent, 0),
    invalidated_attempts: state.invalidated_attempts,
    units_by_status: byStatus,
  };
}
