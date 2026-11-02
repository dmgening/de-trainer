import { CHECKER_VERSION, SCHEDULER_VERSION, SCHEMA_VERSION, summarize, type ExportFile } from '@de-trainer/core';
import type { ContentService } from './content/service';
import type { Db } from './db/client';
import { listUserBanks } from './db/repo';
import type { LearnerService } from './learner/service';

/** Full portable export of one learner: complete log, versions, priorities and a summary rebuilt from the log. */
export function buildExport(deps: { db: Db; content: ContentService; learner: LearnerService }, user: { userId: string; displayName: string }): ExportFile {
  const events = deps.learner.all(user.userId);
  const scheduler = deps.learner.schedulerConfig(user.userId);
  const banks = listUserBanks(deps.db, user.userId);
  return {
    format: 'de-class-export',
    format_version: 1,
    exported_at: new Date().toISOString(),
    schema_version: SCHEMA_VERSION,
    scheduler_version: SCHEDULER_VERSION,
    checker_version: CHECKER_VERSION,
    user: { user_id: user.userId, display_name: user.displayName },
    period: {
      complete: true,
      first_ts: events[0]?.client_ts ?? null,
      last_ts: events.at(-1)?.client_ts ?? null,
      max_seq: events.at(-1)?.seq ?? 0,
    },
    banks: banks.map((b) => ({ bank_id: b.bankId, head: deps.content.head(b.bankId), versions: deps.content.versions(b.bankId) })),
    events,
    recommendations: deps.learner.recommendations(user.userId),
    scheduler_config: scheduler,
    summary: banks.map((b) => summarize(events, { bank_id: b.bankId, config: scheduler.config })),
  };
}
