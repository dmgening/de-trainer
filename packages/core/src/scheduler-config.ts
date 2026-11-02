import { z } from 'zod';
import { Id, IsoDateTime, safeText } from './primitives';

/** Bumped whenever deriveState or buildSession change behaviour; stored with sessions and attempts. */
export const SCHEDULER_VERSION = 1;

const share = z.number().min(0).max(0.7);

/**
 * Scheduler parameters. The bounds below are the limits within which Nomir may tune them (PRD §7.2);
 * values are pilot hypotheses, not facts about the learner.
 */
export const SchedulerConfig = z
  .strictObject({
    ladder_days: z.array(z.number().int().min(1).max(365)).min(3).max(10),
    weights: z.strictObject({ weak: share, recent: share, due: share, variety: share }),
    default_session_size: z.number().int().min(5).max(30),
    /** How many latest lessons (by lesson_order) count as recent. */
    recent_lessons: z.number().int().min(1).max(5),
    max_per_family: z.number().int().min(1).max(5),
    max_topic_share: z.number().min(0.3).max(1),
    /** Never-seen exercises per session, while other material is available. */
    new_per_session: z.number().int().min(0).max(20),
    stable: z.strictObject({
      min_step: z.number().int().min(2).max(10),
      min_days: z.number().int().min(1).max(10),
      min_exercises: z.number().int().min(1).max(10),
    }),
  })
  .superRefine((c, ctx) => {
    if (c.ladder_days.some((d, i) => i > 0 && d <= c.ladder_days[i - 1]!)) {
      ctx.addIssue({ code: 'custom', path: ['ladder_days'], message: 'Intervals must grow strictly' });
    }
    const w = c.weights;
    if (w.weak + w.recent + w.due + w.variety < 0.5) {
      ctx.addIssue({ code: 'custom', path: ['weights'], message: 'Bucket weights must add up to at least 0.5' });
    }
  });
export type SchedulerConfig = z.infer<typeof SchedulerConfig>;

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  ladder_days: [1, 3, 7, 14, 30],
  weights: { weak: 0.4, recent: 0.3, due: 0.2, variety: 0.1 },
  default_session_size: 10,
  recent_lessons: 2,
  max_per_family: 2,
  max_topic_share: 0.6,
  new_per_session: 5,
  stable: { min_step: 3, min_days: 2, min_exercises: 2 },
};

export const RecommendationScope = z.enum(['skill', 'knowledge_item', 'topic', 'exercise', 'family']);

export const Recommendation = z.strictObject({
  recommendation_id: Id,
  scope: z.strictObject({ type: RecommendationScope, id: Id }),
  /** 0..1: how strongly to favour this focus inside the "weak" share of a session. */
  weight: z.number().min(0).max(1),
  /** Shown to the learner as the reason ("ошибки в Dativ после mit"), in Russian. */
  reason: safeText(300),
  expires_at: IsoDateTime,
});
export type Recommendation = z.infer<typeof Recommendation>;

/** Nomir replaces the whole set at once; an empty list clears it. */
export const RecommendationSet = z.strictObject({
  generated_at: IsoDateTime,
  recommendations: z.array(Recommendation).max(200),
});
export type RecommendationSet = z.infer<typeof RecommendationSet>;

export function activeRecommendations(set: RecommendationSet | null | undefined, now: Date): Recommendation[] {
  if (!set) return [];
  return set.recommendations.filter((r) => Date.parse(r.expires_at) > now.getTime());
}
