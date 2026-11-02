import {
  CHECKER_VERSION,
  SCHEDULER_VERSION,
  buildSession,
  localDate,
  partItems,
  pickRetry,
  uuidv7,
  type AttemptResult,
  type BankSnapshot,
  type CheckResult,
  type Exercise,
  type LearnerEvent,
  type LearnerState,
  type PlanItem,
  type Recommendation,
  type Response,
  type SchedulerConfig,
  type SessionFilter,
  type SessionMode,
} from '@de-trainer/core';
import type { Backend } from './backend';
import { applyDownloadedSnapshots, type ActiveSession } from './db';

const MAX_RETRIES = 3;

function base(b: Backend) {
  const now = new Date();
  return { event_id: uuidv7(now.getTime()), user_id: b.userId, device_id: b.deviceId, client_ts: now.toISOString() };
}

async function append(b: Backend, event: LearnerEvent, active: ActiveSession | null | undefined) {
  const { db } = b;
  await db.transaction('rw', db.events, db.kv, async () => {
    await db.events.add({ ...event, synced: 0 });
    if (active !== undefined) await db.put('active_session', active);
  });
  b.onWrite();
}

export async function startSession(
  b: Backend,
  input: { bank: BankSnapshot; state: LearnerState; recommendations: Recommendation[]; config: SchedulerConfig; mode: SessionMode; size: number; filter?: SessionFilter },
): Promise<ActiveSession | null> {
  const seed = uuidv7();
  const plan = buildSession({ ...input, seed, today: localDate(new Date()) });
  if (plan.length === 0) return null;
  const e = base(b);
  const active: ActiveSession = {
    session_id: uuidv7(),
    bank_id: input.bank.bank_id,
    bank_version: input.bank.version,
    mode: input.mode,
    filter: input.filter,
    queue: plan,
    index: 0,
    retries: 0,
    results: [],
    started_at: e.client_ts,
  };
  await append(
    b,
    {
      ...e,
      type: 'session_started',
      payload: {
        session_id: active.session_id,
        bank_id: active.bank_id,
        bank_version: active.bank_version,
        mode: input.mode,
        size: plan.length,
        seed,
        ...(input.filter ? { filter: input.filter } : {}),
        plan,
        scheduler_version: SCHEDULER_VERSION,
      },
    },
    active,
  );
  return active;
}

/**
 * Writes the attempt and moves the session on in one local transaction, before the learner
 * sees the next question. After a mistake the skill comes back later, preferably with another example.
 */
export async function recordAttempt(
  b: Backend,
  input: {
    active: ActiveSession;
    item: PlanItem;
    exercise: Exercise;
    bank: BankSnapshot;
    state: LearnerState;
    response: Response | null;
    result: AttemptResult;
    check?: CheckResult;
    hintsUsed: number;
    startedAt: Date;
  },
) {
  const { active, item, exercise: ex } = input;
  const e = base(b);
  const answeredAt = new Date(e.client_ts);
  const queue = [...active.queue];
  let retries = active.retries;
  const isRetry = item.bucket === 'retry';
  if ((input.result === 'wrong' || input.result === 'revealed') && active.mode === 'recommended' && !isRetry && retries < MAX_RETRIES) {
    const used = new Set(queue.map((q) => q.exercise_id));
    const again = pickRetry(input.bank, input.state, ex, used) ?? ex;
    queue.splice(Math.min(active.index + 4, queue.length), 0, {
      exercise_id: again.exercise_id,
      revision: again.revision,
      bucket: 'retry',
      reason: { code: 'retry' },
    });
    retries++;
  }
  const next: ActiveSession = { ...active, queue, retries, index: active.index + 1, results: [...active.results, input.result] };
  await append(
    b,
    {
      ...e,
      type: 'attempt',
      payload: {
        attempt_id: e.event_id,
        session_id: active.session_id,
        mode: active.mode,
        bank_id: active.bank_id,
        bank_version: active.bank_version,
        exercise_id: ex.exercise_id,
        exercise_revision: ex.revision,
        family_id: ex.family_id,
        topic_ids: ex.topic_ids,
        primary_skill_id: ex.primary_skill_id,
        knowledge_item_ids: ex.knowledge_item_ids,
        ...(partItems(ex) ? { part_items: partItems(ex) } : {}),
        started_at: input.startedAt.toISOString(),
        answered_at: e.client_ts,
        duration_ms: Math.max(0, answeredAt.getTime() - input.startedAt.getTime()),
        local_date: localDate(answeredAt),
        response: input.response,
        result: input.result,
        ...(input.check?.parts ? { parts: input.check.parts } : {}),
        hints_used: input.hintsUsed,
        retry: isRetry,
        checker_version: CHECKER_VERSION,
        scheduler_version: SCHEDULER_VERSION,
      },
    },
    next,
  );
  return next;
}

export async function finishSession(b: Backend, active: ActiveSession, abandoned: boolean) {
  const count = (r: AttemptResult) => active.results.filter((x) => x === r).length;
  await append(
    b,
    {
      ...base(b),
      type: 'session_finished',
      payload: {
        session_id: active.session_id,
        abandoned,
        summary: {
          total: active.results.length,
          correct: count('correct'),
          near_miss: count('near_miss'),
          wrong: count('wrong'),
          skipped: count('skipped'),
          revealed: count('revealed'),
        },
      },
    },
    null,
  );
  // A bank update that arrived during the session is applied only now (A14).
  await applyDownloadedSnapshots(b.db);
}

/** Free text from the learner, made safe for the server's no-markup rule. */
// eslint-disable-next-line no-control-regex
const clean = (s: string) => s.replace(/[<>&]/g, ' ').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, 1000);

/** Disputed: hidden from sessions at once, even offline, until Nomir resolves it. */
export async function flagExercise(b: Backend, ex: Exercise, bankId: string, comment: string, active: ActiveSession | null) {
  const skipCurrent = active && active.queue[active.index]?.exercise_id === ex.exercise_id;
  const next = skipCurrent ? { ...active, index: active.index + 1 } : undefined;
  await append(
    b,
    {
      ...base(b),
      type: 'exercise_flagged',
      payload: { flag_id: uuidv7(), bank_id: bankId, exercise_id: ex.exercise_id, revision: ex.revision, ...(clean(comment) ? { comment: clean(comment) } : {}) },
    },
    next,
  );
  return next ?? active;
}
