import type { BankSnapshot, Exercise } from './content';
import type { Bucket, PlanItem, ReasonCode, SessionMode } from './events';
import { daysBetween } from './primitives';
import type { Recommendation, SchedulerConfig } from './scheduler-config';
import { exerciseUnits, type LearnerState } from './state';

/** Seeded RNG (mulberry32 over an FNV-1a hash): a session can be rebuilt from its seed. */
export function createRng(seed: string): () => number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type SessionFilter = { topic_ids?: string[]; skill_ids?: string[] };

export type BuildSessionInput = {
  bank: BankSnapshot;
  state: LearnerState;
  recommendations: Recommendation[];
  config: SchedulerConfig;
  seed: string;
  /** The learner's local date: due checks are day-based. */
  today: string;
  size: number;
  mode: SessionMode;
  filter?: SessionFilter;
};

type Ranked = { ex: Exercise; reason: PlanItem['reason'] };
const BUCKETS = ['weak', 'recent', 'due', 'variety'] as const;

/** Split `size` by weights with largest remainders, so short sessions keep their exact size. */
export function quotas(size: number, weights: SchedulerConfig['weights']): Record<(typeof BUCKETS)[number], number> {
  const total = BUCKETS.reduce((s, b) => s + weights[b], 0) || 1;
  const raw = BUCKETS.map((b) => (size * weights[b]) / total);
  const out = raw.map(Math.floor);
  let left = size - out.reduce((s, n) => s + n, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left-- <= 0) break;
    out[i]!++;
  }
  return { weak: out[0]!, recent: out[1]!, due: out[2]!, variety: out[3]! };
}

export function isPlayable(ex: Exercise, state: LearnerState) {
  return ex.status === 'published' && !state.flagged[ex.exercise_id];
}

function matchesFilter(ex: Exercise, filter?: SessionFilter) {
  if (!filter) return true;
  if (filter.topic_ids?.length && !ex.topic_ids.some((t) => filter.topic_ids!.includes(t))) return false;
  if (filter.skill_ids?.length) {
    const skills = [ex.primary_skill_id, ...ex.secondary_skill_ids];
    if (!skills.some((s) => filter.skill_ids!.includes(s))) return false;
  }
  return true;
}

function recommendationMatch(ex: Exercise, r: Recommendation): boolean {
  const id = r.scope.id;
  switch (r.scope.type) {
    case 'skill':
      return ex.primary_skill_id === id || ex.secondary_skill_ids.includes(id);
    case 'knowledge_item':
      return exerciseUnits(ex).includes(`item:${id}`);
    case 'topic':
      return ex.topic_ids.includes(id);
    case 'exercise':
      return ex.exercise_id === id;
    case 'family':
      return ex.family_id === id;
  }
}

/**
 * Builds a session from four buckets (PRD §7.2): weak spots, recent lessons, due review, variety.
 * Each exercise appears once; unfilled bucket quotas flow to the next bucket and then to a final fill.
 */
export function buildSession(input: BuildSessionInput): PlanItem[] {
  const { bank, state, recommendations, config, today, mode, filter } = input;
  const rng = createRng(input.seed);
  const candidates = bank.exercises
    .filter((ex) => isPlayable(ex, state) && matchesFilter(ex, filter))
    .sort((a, b) => (a.exercise_id < b.exercise_id ? -1 : 1));
  const size = Math.min(input.size, candidates.length);
  if (size === 0) return [];

  const tie = new Map(candidates.map((ex) => [ex.exercise_id, rng()]));
  const seen = (ex: Exercise) => state.exercise_last_seen[ex.exercise_id];
  const byTie = (a: Exercise, b: Exercise) => tie.get(a.exercise_id)! - tie.get(b.exercise_id)!;
  // Never seen first, then the longest ago.
  const bySeen = (a: Exercise, b: Exercise) => (seen(a) ?? '').localeCompare(seen(b) ?? '');

  const topicOrder = new Map(bank.topics.map((t) => [t.topic_id, t.lesson_order]));
  const recentOrders = [...new Set(bank.topics.map((t) => t.lesson_order))].sort((a, b) => b - a).slice(0, config.recent_lessons);
  const isRecent = (ex: Exercise) => ex.topic_ids.some((t) => recentOrders.includes(topicOrder.get(t) ?? -1));
  const seenTopics = new Set(candidates.filter((ex) => seen(ex)).flatMap((ex) => ex.topic_ids));

  const lists: Record<(typeof BUCKETS)[number], Ranked[]> = { weak: [], recent: [], due: [], variety: [] };

  if (recommendations.length > 0) {
    const scored = candidates
      .map((ex) => {
        const best = recommendations.filter((r) => recommendationMatch(ex, r)).sort((a, b) => b.weight - a.weight)[0];
        return { ex, best };
      })
      .filter((x) => x.best && x.best.weight > 0);
    scored.sort((a, b) => b.best!.weight - a.best!.weight || bySeen(a.ex, b.ex) || byTie(a.ex, b.ex));
    lists.weak = scored.map(({ ex, best }) => ({ ex, reason: { code: 'nomir', text: best!.reason } }));
  } else {
    const weak = new Set(Object.entries(state.units).filter(([, u]) => u.status === 'needs_practice').map(([k]) => k));
    const score = (ex: Exercise) => exerciseUnits(ex).filter((k) => weak.has(k)).length;
    lists.weak = candidates
      .filter((ex) => score(ex) > 0)
      .sort((a, b) => bySeen(a, b) || score(b) - score(a) || byTie(a, b))
      .map((ex) => ({ ex, reason: { code: 'recent_errors' } }));
  }

  lists.recent = candidates
    .filter(isRecent)
    .sort((a, b) => Number(!!seen(a)) - Number(!!seen(b)) || b.editorial_priority - a.editorial_priority || bySeen(a, b) || byTie(a, b))
    .map((ex) => ({
      ex,
      reason: { code: (ex.topic_ids.some((t) => !seenTopics.has(t)) ? 'new_topic' : 'recent_topic') as ReasonCode },
    }));

  const dueScore = (ex: Exercise) =>
    exerciseUnits(ex).reduce((s, k) => {
      const u = state.units[k];
      if (!u?.due_date || u.due_date > today) return s;
      return s + 1 + daysBetween(u.due_date, today) * 0.1;
    }, 0);
  const famSeen = (ex: Exercise) => state.family_last_seen[ex.family_id] ?? '';
  lists.due = candidates
    .filter((ex) => dueScore(ex) > 0)
    .sort((a, b) => famSeen(a).localeCompare(famSeen(b)) || dueScore(b) - dueScore(a) || byTie(a, b))
    .map((ex) => ({ ex, reason: { code: 'due' } }));

  lists.variety = [...candidates]
    .sort((a, b) => Number(isRecent(a)) - Number(isRecent(b)) || bySeen(a, b) || byTie(a, b))
    .map((ex) => ({ ex, reason: { code: 'variety' } }));

  const chosen: { ex: Exercise; bucket: Bucket; reason: PlanItem['reason'] }[] = [];
  const used = new Set<string>();
  const perFamily = new Map<string, number>();
  const perTopic = new Map<string, number>();
  let fresh = 0;
  const topicCap = Math.max(1, Math.ceil(config.max_topic_share * size));

  // level 0: all limits; 1: drop new-item and topic-share limits; 2: drop the family limit too.
  const fits = (ex: Exercise, level: number) => {
    if (used.has(ex.exercise_id)) return false;
    if (level < 2 && (perFamily.get(ex.family_id) ?? 0) >= config.max_per_family) return false;
    if (level < 1 && (perTopic.get(ex.topic_ids[0]!) ?? 0) >= topicCap) return false;
    if (level < 1 && !seen(ex) && fresh >= config.new_per_session) return false;
    return true;
  };
  const take = (r: Ranked, bucket: Bucket) => {
    chosen.push({ ex: r.ex, bucket, reason: r.reason });
    used.add(r.ex.exercise_id);
    perFamily.set(r.ex.family_id, (perFamily.get(r.ex.family_id) ?? 0) + 1);
    perTopic.set(r.ex.topic_ids[0]!, (perTopic.get(r.ex.topic_ids[0]!) ?? 0) + 1);
    if (!seen(r.ex)) fresh++;
  };

  const q = quotas(size, config.weights);
  let carry = 0;
  for (const bucket of BUCKETS) {
    let need = q[bucket] + carry;
    for (const r of lists[bucket]) {
      if (need === 0) break;
      if (fits(r.ex, 0)) {
        take(r, bucket);
        need--;
      }
    }
    carry = need;
  }
  for (let level = 0; level <= 2 && chosen.length < size; level++) {
    for (const bucket of ['weak', 'recent', 'due', 'variety'] as const) {
      for (const r of lists[bucket]) {
        if (chosen.length >= size) break;
        if (fits(r.ex, level)) take(r, bucket);
      }
    }
  }

  return shuffle(chosen, rng).map(({ ex, bucket, reason }) => ({
    exercise_id: ex.exercise_id,
    revision: ex.revision,
    bucket,
    reason: mode === 'practice' && reason.code !== 'nomir' ? { code: 'practice' } : reason,
  }));
}

/**
 * After a mistake the session may come back to the skill later, preferably with another example.
 * Returns null when nothing else is available.
 */
export function pickRetry(bank: BankSnapshot, state: LearnerState, failed: Exercise, inSession: Set<string>): Exercise | null {
  const options = bank.exercises.filter(
    (ex) =>
      isPlayable(ex, state) &&
      ex.exercise_id !== failed.exercise_id &&
      !inSession.has(ex.exercise_id) &&
      ex.primary_skill_id === failed.primary_skill_id,
  );
  options.sort((a, b) => Number(b.family_id === failed.family_id) - Number(a.family_id === failed.family_id) || (a.exercise_id < b.exercise_id ? -1 : 1));
  return options[0] ?? null;
}
