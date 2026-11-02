import { and, desc, eq, gt, inArray, max } from 'drizzle-orm';
import {
  DEFAULT_SCHEDULER_CONFIG,
  type LearnerEvent,
  type RecommendationSet,
  type SchedulerConfig,
  type StoredEvent,
} from '@de-trainer/core';
import type { Db } from '../db/client';
import { events, recommendationSets, schedulerConfigs } from '../db/schema';

/** Devices' clocks are trusted for ordering, but a timestamp this far ahead is marked suspect. */
const CLOCK_SKEW_MS = 5 * 60_000;

type EventRow = typeof events.$inferSelect;

function toStored(r: EventRow): StoredEvent {
  return {
    event_id: r.eventId,
    user_id: r.userId,
    device_id: r.deviceId,
    client_ts: r.clientTs,
    type: r.type,
    payload: JSON.parse(r.payload),
    seq: r.seq,
    actor: r.actor,
    server_received_at: r.serverReceivedAt,
    clock_suspect: r.clockSuspect,
  } as StoredEvent;
}

const maxSeq = (db: Db, userId: string) =>
  db.select({ v: max(events.seq) }).from(events).where(eq(events.userId, userId)).get()?.v ?? 0;

/**
 * Every query here takes the user ID as a required argument: there is no way to read
 * or write learner data without naming whose it is.
 */
export function createLearnerService(db: Db) {
  return {
    /** Idempotent: an event ID already stored is counted as a duplicate and left as it was. */
    append(userId: string, batch: LearnerEvent[], actor: string, received = new Date()) {
      const receivedAt = received.toISOString();
      let accepted = 0;
      db.transaction(() => {
        for (const e of batch) {
          const changes = db
            .insert(events)
            .values({
              eventId: e.event_id,
              userId,
              deviceId: e.device_id,
              type: e.type,
              actor,
              clientTs: e.client_ts,
              serverReceivedAt: receivedAt,
              clockSuspect: Date.parse(e.client_ts) > received.getTime() + CLOCK_SKEW_MS,
              payload: JSON.stringify(e.payload),
            })
            .onConflictDoNothing({ target: events.eventId })
            .run().changes;
          accepted += changes;
        }
      });
      return { accepted, duplicates: batch.length - accepted, max_seq: maxSeq(db, userId) };
    },

    list(userId: string, opts: { since: number; limit: number; types?: string[] }) {
      const where = [eq(events.userId, userId), gt(events.seq, opts.since)];
      if (opts.types?.length) where.push(inArray(events.type, opts.types));
      const rows = db
        .select()
        .from(events)
        .where(and(...where))
        .orderBy(events.seq)
        .limit(opts.limit + 1)
        .all();
      const page = rows.slice(0, opts.limit).map(toStored);
      const last = page.at(-1)?.seq ?? opts.since;
      return { events: page, has_more: rows.length > opts.limit, max_seq: rows.length > opts.limit ? last : Math.max(last, maxSeq(db, userId)) };
    },

    all(userId: string): StoredEvent[] {
      return db.select().from(events).where(eq(events.userId, userId)).orderBy(events.seq).all().map(toStored);
    },

    /** Restores rows exactly as exported (A07); event IDs keep restores idempotent. */
    restore(userId: string, stored: StoredEvent[]) {
      let imported = 0;
      db.transaction(() => {
        for (const e of [...stored].sort((a, b) => a.seq - b.seq)) {
          imported += db
            .insert(events)
            .values({
              eventId: e.event_id,
              userId,
              deviceId: e.device_id,
              type: e.type,
              actor: e.actor,
              clientTs: e.client_ts,
              serverReceivedAt: e.server_received_at,
              clockSuspect: e.clock_suspect,
              payload: JSON.stringify(e.payload),
            })
            .onConflictDoNothing({ target: events.eventId })
            .run().changes;
        }
      });
      return { imported, duplicates: stored.length - imported };
    },

    recommendations(userId: string): { version: number; set: RecommendationSet | null } {
      const row = db.select().from(recommendationSets).where(eq(recommendationSets.userId, userId)).orderBy(desc(recommendationSets.version)).get();
      return row ? { version: row.version, set: JSON.parse(row.body) as RecommendationSet } : { version: 0, set: null };
    },

    putRecommendations(userId: string, set: RecommendationSet, actor: string) {
      const version = this.recommendations(userId).version + 1;
      db.insert(recommendationSets).values({ userId, version, body: JSON.stringify(set), createdBy: actor, createdAt: new Date().toISOString() }).run();
      return version;
    },

    schedulerConfig(userId: string): { version: number; config: SchedulerConfig } {
      const row = db.select().from(schedulerConfigs).where(eq(schedulerConfigs.userId, userId)).orderBy(desc(schedulerConfigs.version)).get();
      return row ? { version: row.version, config: JSON.parse(row.body) as SchedulerConfig } : { version: 0, config: DEFAULT_SCHEDULER_CONFIG };
    },

    putSchedulerConfig(userId: string, config: SchedulerConfig, actor: string) {
      const version = this.schedulerConfig(userId).version + 1;
      db.insert(schedulerConfigs).values({ userId, version, body: JSON.stringify(config), createdBy: actor, createdAt: new Date().toISOString() }).run();
      return version;
    },
  };
}

export type LearnerService = ReturnType<typeof createLearnerService>;
