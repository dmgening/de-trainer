import { z } from 'zod';
import { ClientEvent, LearnerEvent, StoredEventMeta } from './events';
import { Id, IsoDateTime } from './primitives';
import { RecommendationSet, SchedulerConfig } from './scheduler-config';

export const PERMISSIONS = [
  'events:read',
  'events:write',
  'recommendations:write',
  'scheduler:write',
  'bank:publish',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

export const GrantScope = z.enum(['user', 'bank']);
export type GrantScope = z.infer<typeof GrantScope>;

export const BankRole = z.enum(['owner', 'learner']);
export type BankRole = z.infer<typeof BankRole>;

export const MeResponse = z.object({
  user_id: z.string(),
  email: z.string(),
  display_name: z.string(),
  banks: z.array(z.object({ bank_id: z.string(), title: z.string(), role: z.string() })),
  schema_version: z.number().int(),
  scheduler_version: z.number().int(),
  checker_version: z.number().int(),
  /** Where to send the browser after local data is wiped: Access logout in prod, cookie reset in dev. */
  logout_url: z.string(),
});
export type MeResponse = z.infer<typeof MeResponse>;

export const AgentWhoamiResponse = z.object({
  agent_id: z.string(),
  name: z.string(),
  grants: z.array(z.object({ scope_type: GrantScope, scope_id: z.string(), permission: Permission })),
});
export type AgentWhoamiResponse = z.infer<typeof AgentWhoamiResponse>;

export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const SyncPushRequest = z.strictObject({ events: z.array(ClientEvent).min(1).max(500) });
export type SyncPushRequest = z.infer<typeof SyncPushRequest>;

export const SyncPushResponse = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  max_seq: z.number().int(),
});
export type SyncPushResponse = z.infer<typeof SyncPushResponse>;

export const StoredEventSchema = z.intersection(LearnerEvent, StoredEventMeta);

export const BankHead = z.object({
  bank_id: Id,
  title: z.string(),
  role: z.string(),
  /** null until the first package is published. */
  version: z.number().int().nullable(),
});
export type BankHead = z.infer<typeof BankHead>;

export const SyncPullResponse = z.object({
  events: z.array(StoredEventSchema),
  max_seq: z.number().int(),
  has_more: z.boolean(),
  banks: z.array(BankHead),
  recommendations: z.object({ version: z.number().int(), set: RecommendationSet.nullable() }),
  scheduler_config: z.object({ version: z.number().int(), config: SchedulerConfig }),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponse>;

export const DiffSummary = z.object({ added: z.array(z.string()), changed: z.array(z.string()), retired: z.array(z.string()) });

export const BankVersionInfo = z.object({
  version: z.number().int(),
  kind: z.enum(['publish', 'rollback']),
  package_id: z.string().nullable(),
  package_version: z.number().int().nullable(),
  rollback_to: z.number().int().nullable(),
  changelog: z.string(),
  diff: DiffSummary,
  created_by: z.string(),
  created_at: IsoDateTime,
});
export type BankVersionInfo = z.infer<typeof BankVersionInfo>;

export const BankVersionsResponse = z.object({ bank_id: Id, head: z.number().int().nullable(), versions: z.array(BankVersionInfo) });
export type BankVersionsResponse = z.infer<typeof BankVersionsResponse>;

export const RollbackRequest = z.strictObject({ to_version: z.number().int().min(1) });

export const PublishResponse = z.object({
  bank_id: Id,
  version: z.number().int(),
  /** "unchanged": the same package_id/package_version was already published with the same content. */
  status: z.enum(['published', 'unchanged', 'valid']),
  diff: DiffSummary,
});
export type PublishResponse = z.infer<typeof PublishResponse>;

/** Portable full export of one learner (PRD §8.3, B6). */
export const ExportFile = z.object({
  format: z.literal('de-class-export'),
  format_version: z.literal(1),
  exported_at: IsoDateTime,
  schema_version: z.number().int(),
  scheduler_version: z.number().int(),
  checker_version: z.number().int(),
  user: z.object({ user_id: z.string(), display_name: z.string() }),
  /** The log is complete: every event of the user from seq 1 up to max_seq. */
  period: z.object({ complete: z.literal(true), first_ts: z.string().nullable(), last_ts: z.string().nullable(), max_seq: z.number().int() }),
  banks: z.array(z.object({ bank_id: z.string(), head: z.number().int().nullable(), versions: z.array(BankVersionInfo) })),
  events: z.array(StoredEventSchema),
  recommendations: z.object({ version: z.number().int(), set: RecommendationSet.nullable() }),
  scheduler_config: z.object({ version: z.number().int(), config: SchedulerConfig }),
  summary: z.array(z.record(z.string(), z.unknown())),
});
export type ExportFile = z.infer<typeof ExportFile>;

