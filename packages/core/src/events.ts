import { z } from 'zod';
import { PartOutcome, Response } from './check';
import { Id, IsoDateTime, LocalDate, Uuid, safeText } from './primitives';

export const SessionMode = z.enum(['recommended', 'practice']);
export type SessionMode = z.infer<typeof SessionMode>;

export const Bucket = z.enum(['weak', 'recent', 'due', 'variety', 'retry']);
export type Bucket = z.infer<typeof Bucket>;

export const ReasonCode = z.enum(['nomir', 'recent_errors', 'new_topic', 'recent_topic', 'due', 'variety', 'retry', 'practice']);
export type ReasonCode = z.infer<typeof ReasonCode>;

export const PlanItem = z.strictObject({
  exercise_id: Id,
  revision: z.number().int().min(1),
  bucket: Bucket,
  reason: z.strictObject({ code: ReasonCode, text: safeText(300).optional() }),
});
export type PlanItem = z.infer<typeof PlanItem>;

export const AttemptResult = z.enum(['correct', 'near_miss', 'wrong', 'skipped', 'revealed']);
export type AttemptResult = z.infer<typeof AttemptResult>;

const base = {
  event_id: Uuid,
  user_id: Uuid,
  device_id: z.string().min(1).max(80),
  client_ts: IsoDateTime,
};

export const SessionStartedEvent = z.strictObject({
  ...base,
  type: z.literal('session_started'),
  payload: z.strictObject({
    session_id: Uuid,
    bank_id: Id,
    bank_version: z.number().int().min(1),
    mode: SessionMode,
    size: z.number().int().min(1).max(60),
    seed: z.string().max(80),
    filter: z.strictObject({ topic_ids: z.array(Id).max(50).optional(), skill_ids: z.array(Id).max(50).optional() }).optional(),
    plan: z.array(PlanItem).max(60),
    scheduler_version: z.number().int(),
  }),
});

export const AttemptEvent = z.strictObject({
  ...base,
  type: z.literal('attempt'),
  payload: z.strictObject({
    attempt_id: Uuid,
    session_id: Uuid,
    mode: SessionMode,
    bank_id: Id,
    bank_version: z.number().int().min(1),
    exercise_id: Id,
    exercise_revision: z.number().int().min(1),
    // Copies of the revision's tags, so state can be derived without old revisions on the device.
    family_id: Id,
    topic_ids: z.array(Id).max(5),
    primary_skill_id: Id,
    knowledge_item_ids: z.array(Id).max(20),
    part_items: z.record(Id, z.array(Id).max(10)).optional(),
    started_at: IsoDateTime,
    answered_at: IsoDateTime,
    duration_ms: z.number().int().min(0),
    local_date: LocalDate,
    response: Response.nullable(),
    result: AttemptResult,
    parts: z.array(z.strictObject({ id: Id, outcome: PartOutcome })).max(12).optional(),
    hints_used: z.number().int().min(0).max(10),
    /** Repeat after feedback inside the same session: practice, never proof of retention. */
    retry: z.boolean(),
    checker_version: z.number().int(),
    scheduler_version: z.number().int(),
  }),
});

export const SessionFinishedEvent = z.strictObject({
  ...base,
  type: z.literal('session_finished'),
  payload: z.strictObject({
    session_id: Uuid,
    abandoned: z.boolean(),
    summary: z.strictObject({
      total: z.number().int().min(0),
      correct: z.number().int().min(0),
      near_miss: z.number().int().min(0),
      wrong: z.number().int().min(0),
      skipped: z.number().int().min(0),
      revealed: z.number().int().min(0),
    }),
  }),
});

export const ExerciseFlaggedEvent = z.strictObject({
  ...base,
  type: z.literal('exercise_flagged'),
  payload: z.strictObject({
    flag_id: Uuid,
    bank_id: Id,
    exercise_id: Id,
    revision: z.number().int().min(1),
    comment: safeText(1000).optional(),
  }),
});

export const DiagnosisEvent = z.strictObject({
  ...base,
  type: z.literal('diagnosis'),
  payload: z.strictObject({
    attempt_ids: z.array(Uuid).max(200),
    skill_ids: z.array(Id).max(50).default([]),
    knowledge_item_ids: z.array(Id).max(100).default([]),
    note: safeText(4000),
  }),
});

export const FlagResolvedEvent = z.strictObject({
  ...base,
  type: z.literal('flag_resolved'),
  payload: z.strictObject({
    bank_id: Id,
    exercise_id: Id,
    flag_id: Uuid.optional(),
    decision: z.enum(['fixed', 'retired', 'rejected']),
    /** For "fixed": the revision that carries the fix. */
    revision: z.number().int().min(1).optional(),
    note: safeText(2000).optional(),
  }),
});

export const AttemptsInvalidatedEvent = z.strictObject({
  ...base,
  type: z.literal('attempts_invalidated'),
  payload: z.strictObject({
    bank_id: Id,
    exercise_id: Id,
    /** Attempts on revisions below this one stop counting towards knowledge. */
    revisions_below: z.number().int().min(2),
    reason: safeText(500),
  }),
});

export const LearnerEvent = z.discriminatedUnion('type', [
  SessionStartedEvent,
  AttemptEvent,
  SessionFinishedEvent,
  ExerciseFlaggedEvent,
  DiagnosisEvent,
  FlagResolvedEvent,
  AttemptsInvalidatedEvent,
]);
export type LearnerEvent = z.infer<typeof LearnerEvent>;
export type EventType = LearnerEvent['type'];
export type EventOf<T extends EventType> = Extract<LearnerEvent, { type: T }>;

/** Written by the learner's devices through /api/sync/push. */
export const CLIENT_EVENT_TYPES = ['session_started', 'attempt', 'session_finished', 'exercise_flagged'] as const;
/** Written by Nomir through the agent API; the server also writes attempts_invalidated on key fixes. */
export const AGENT_EVENT_TYPES = ['diagnosis', 'flag_resolved', 'attempts_invalidated'] as const;

export const ClientEvent = z.discriminatedUnion('type', [
  SessionStartedEvent,
  AttemptEvent,
  SessionFinishedEvent,
  ExerciseFlaggedEvent,
]);
export type ClientEvent = z.infer<typeof ClientEvent>;

/** What Nomir sends: the server fills in user_id, device_id and client_ts. */
export const AgentEventInput = z.discriminatedUnion('type', [
  DiagnosisEvent.pick({ type: true, payload: true }).extend({ event_id: Uuid.optional() }),
  FlagResolvedEvent.pick({ type: true, payload: true }).extend({ event_id: Uuid.optional() }),
  AttemptsInvalidatedEvent.pick({ type: true, payload: true }).extend({ event_id: Uuid.optional() }),
]);
export type AgentEventInput = z.infer<typeof AgentEventInput>;

/** An event as stored on the server and returned by pull. */
export type StoredEvent = LearnerEvent & {
  seq: number;
  actor: string;
  server_received_at: string;
  clock_suspect: boolean;
};
export const StoredEventMeta = z.strictObject({
  seq: z.number().int().min(1),
  actor: z.string(),
  server_received_at: IsoDateTime,
  clock_suspect: z.boolean(),
});

/** Total order shared by every device and the server: client time, then event ID. */
export function compareEvents(a: Pick<LearnerEvent, 'client_ts' | 'event_id'>, b: Pick<LearnerEvent, 'client_ts' | 'event_id'>) {
  const ta = Date.parse(a.client_ts);
  const tb = Date.parse(b.client_ts);
  if (ta !== tb) return ta - tb;
  return a.event_id < b.event_id ? -1 : a.event_id > b.event_id ? 1 : 0;
}
