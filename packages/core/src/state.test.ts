import { describe, expect, it } from 'vitest';
import type { BankSnapshot, Exercise } from './content';
import type { AttemptResult, LearnerEvent } from './events';
import { DEFAULT_SCHEDULER_CONFIG, type Recommendation } from './scheduler-config';
import { buildSession, quotas } from './session';
import { deriveState, sessionHistory, summarize } from './state';

const USER = '00000000-0000-7000-8000-000000000001';
let n = 0;
const uuid = () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
const config = DEFAULT_SCHEDULER_CONFIG;

type AttemptOpts = {
  date: string;
  result: AttemptResult;
  session?: string;
  exercise?: string;
  revision?: number;
  skill?: string;
  items?: string[];
  hints?: number;
  retry?: boolean;
  mode?: 'recommended' | 'practice';
};

function attempt(o: AttemptOpts): LearnerEvent {
  const id = uuid();
  const ts = `${o.date}T10:00:${String(n % 60).padStart(2, '0')}Z`;
  return {
    event_id: id,
    user_id: USER,
    device_id: 'd1',
    client_ts: ts,
    type: 'attempt',
    payload: {
      attempt_id: id,
      session_id: o.session ?? uuid(),
      mode: o.mode ?? 'recommended',
      bank_id: 'b',
      bank_version: 1,
      exercise_id: o.exercise ?? 'ex1',
      exercise_revision: o.revision ?? 1,
      family_id: 'f1',
      topic_ids: ['t1'],
      primary_skill_id: o.skill ?? 'dativ',
      knowledge_item_ids: o.items ?? [],
      started_at: ts,
      answered_at: ts,
      duration_ms: 3000,
      local_date: o.date,
      response: null,
      result: o.result,
      hints_used: o.hints ?? 0,
      retry: o.retry ?? false,
      checker_version: 1,
      scheduler_version: 1,
    },
  };
}

const derive = (events: LearnerEvent[]) => deriveState(events, { bank_id: 'b', config });
const skill = (events: LearnerEvent[], id = 'dativ') => derive(events).units[`skill:${id}`]!;

describe('spaced repetition (A03)', () => {
  it('starts the ladder on the first independent success', () => {
    const u = skill([attempt({ date: '2026-11-01', result: 'correct' })]);
    expect(u.step).toBe(1);
    expect(u.due_date).toBe('2026-11-02');
    expect(u.status).toBe('learning');
  });

  it('moves up only on delayed review', () => {
    const early = skill([attempt({ date: '2026-11-01', result: 'correct' }), attempt({ date: '2026-11-01', result: 'correct' })]);
    expect(early.step).toBe(1);
    const delayed = skill([attempt({ date: '2026-11-01', result: 'correct' }), attempt({ date: '2026-11-02', result: 'correct' })]);
    expect(delayed.step).toBe(2);
    expect(delayed.due_date).toBe('2026-11-05');
  });

  it('never moves up twice in one session', () => {
    const s = uuid();
    const u = skill([
      attempt({ date: '2026-11-01', result: 'correct', session: s }),
      attempt({ date: '2026-11-01', result: 'correct', session: s, exercise: 'ex2' }),
    ]);
    expect(u.step).toBe(1);
  });

  it('does not count an immediate repeat after feedback', () => {
    const u = skill([
      attempt({ date: '2026-11-01', result: 'correct' }),
      attempt({ date: '2026-11-02', result: 'wrong' }),
      attempt({ date: '2026-11-02', result: 'correct', retry: true }),
    ]);
    expect(u.step).toBe(0);
    expect(u.independent_successes).toBe(1);
  });

  it('shortens the interval after a mistake and flags the unit', () => {
    const u = skill([
      attempt({ date: '2026-11-01', result: 'correct' }),
      attempt({ date: '2026-11-02', result: 'correct' }),
      attempt({ date: '2026-11-05', result: 'wrong' }),
    ]);
    expect(u.step).toBe(1);
    expect(u.due_date).toBe('2026-11-06');
    expect(u.status).toBe('needs_practice');
  });

  it('does not count hints, reveals, skips or near misses as independent success', () => {
    const u = skill([
      attempt({ date: '2026-11-01', result: 'correct', hints: 1 }),
      attempt({ date: '2026-11-01', result: 'near_miss' }),
      attempt({ date: '2026-11-01', result: 'skipped' }),
      attempt({ date: '2026-11-01', result: 'revealed' }),
    ]);
    expect(u.independent_successes).toBe(0);
    expect(u.step).toBe(0);
    expect(u.attempts).toBe(3);
    expect(u.errors).toBe(1);
  });

  it('leaves the ladder alone in free practice', () => {
    const u = skill([attempt({ date: '2026-11-01', result: 'correct', mode: 'practice' })]);
    expect(u.step).toBe(0);
    expect(u.independent_successes).toBe(1);
  });

  it('calls a unit stable only after successes on different days and examples', () => {
    const dates = ['2026-11-01', '2026-11-02', '2026-11-05'];
    const sameExercise = skill(dates.map((date) => attempt({ date, result: 'correct' })));
    expect(sameExercise.step).toBe(3);
    expect(sameExercise.status).toBe('consolidating');
    const varied = skill(dates.map((date, i) => attempt({ date, result: 'correct', exercise: `ex${i}` })));
    expect(varied.status).toBe('stable');
  });

  it('gives the same state whatever order the events arrive in', () => {
    const events = [
      attempt({ date: '2026-11-01', result: 'correct' }),
      attempt({ date: '2026-11-02', result: 'wrong' }),
      attempt({ date: '2026-11-03', result: 'correct' }),
    ];
    expect(derive([...events].reverse())).toEqual(derive(events));
  });

  it('grades gap items by their own gap', () => {
    const e = attempt({ date: '2026-11-01', result: 'wrong', items: ['article', 'ending'] });
    if (e.type !== 'attempt') throw new Error();
    e.payload.part_items = { g1: ['article'], g2: ['ending'] };
    e.payload.parts = [
      { id: 'g1', outcome: 'correct' },
      { id: 'g2', outcome: 'wrong' },
    ];
    const state = derive([e]);
    expect(state.units['item:article']!.independent_successes).toBe(1);
    expect(state.units['item:ending']!.errors).toBe(1);
    expect(state.units['skill:dativ']!.errors).toBe(1);
  });
});

describe('key fixes and flags (A06, A17)', () => {
  it('stops counting attempts on revisions with a wrong key', () => {
    const events: LearnerEvent[] = [
      attempt({ date: '2026-11-01', result: 'wrong', revision: 1 }),
      attempt({ date: '2026-11-02', result: 'wrong', revision: 1 }),
      {
        event_id: uuid(),
        user_id: USER,
        device_id: 'server',
        client_ts: '2026-11-03T00:00:00Z',
        type: 'attempts_invalidated',
        payload: { bank_id: 'b', exercise_id: 'ex1', revisions_below: 2, reason: 'key_fix' },
      },
    ];
    const state = derive(events);
    expect(state.invalidated_attempts).toBe(2);
    expect(state.units['skill:dativ']).toBeUndefined();
  });

  it('hides a flagged exercise until Nomir resolves it', () => {
    const flag: LearnerEvent = {
      event_id: uuid(),
      user_id: USER,
      device_id: 'd1',
      client_ts: '2026-11-01T10:00:00Z',
      type: 'exercise_flagged',
      payload: { flag_id: uuid(), bank_id: 'b', exercise_id: 'ex1', revision: 1, comment: 'Ключ неверный' },
    };
    expect(derive([flag]).flagged.ex1).toBeDefined();
    const resolved: LearnerEvent = {
      event_id: uuid(),
      user_id: USER,
      device_id: 'agent:nomir',
      client_ts: '2026-11-02T10:00:00Z',
      type: 'flag_resolved',
      payload: { bank_id: 'b', exercise_id: 'ex1', decision: 'fixed', revision: 2 },
    };
    expect(derive([flag, resolved]).flagged.ex1).toBeUndefined();
  });
});

function ex(id: string, o: Partial<Exercise> = {}): Exercise {
  return {
    exercise_id: id,
    revision: 1,
    family_id: o.family_id ?? id,
    status: 'published',
    topic_ids: o.topic_ids ?? ['old'],
    primary_skill_id: o.primary_skill_id ?? `s-${id}`,
    secondary_skill_ids: [],
    knowledge_item_ids: [],
    prompt: 'p',
    answer_spec: { type: 'choice', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correct: ['a'], shuffle: true },
    explanation: 'e',
    hints: [],
    editorial_priority: 3,
    key_fix: false,
    source_refs: [],
    ...o,
  };
}

function bank(exercises: Exercise[]): BankSnapshot {
  return {
    schema_version: 1,
    bank_id: 'b',
    version: 1,
    created_at: '2026-11-01T00:00:00Z',
    topics: [
      { topic_id: 'old', revision: 1, title: 'Old', lesson_order: 1, editorial_priority: 3, source_refs: [] },
      { topic_id: 'mid', revision: 1, title: 'Mid', lesson_order: 2, editorial_priority: 3, source_refs: [] },
      { topic_id: 'new', revision: 1, title: 'New', lesson_order: 3, editorial_priority: 3, source_refs: [] },
    ],
    skills: [],
    knowledge_items: [],
    exercises,
    media: [],
  };
}

const base = { config, seed: 'seed', today: '2026-11-10', mode: 'recommended' as const, recommendations: [] as Recommendation[] };

describe('session building (A04)', () => {
  const exercises = [
    ...Array.from({ length: 6 }, (_, i) => ex(`old${i}`, { topic_ids: ['old'] })),
    ...Array.from({ length: 6 }, (_, i) => ex(`new${i}`, { topic_ids: ['new'] })),
    ...Array.from({ length: 6 }, (_, i) => ex(`mid${i}`, { topic_ids: ['mid'] })),
  ];

  it('keeps the requested size and never repeats an exercise', () => {
    const plan = buildSession({ ...base, bank: bank(exercises), state: derive([]), size: 10 });
    expect(plan).toHaveLength(10);
    expect(new Set(plan.map((p) => p.exercise_id)).size).toBe(10);
  });

  it('is reproducible from the seed', () => {
    const a = buildSession({ ...base, bank: bank(exercises), state: derive([]), size: 10 });
    const b = buildSession({ ...base, bank: bank(exercises), state: derive([]), size: 10 });
    expect(a).toEqual(b);
  });

  it('gives a new topic a starting priority', () => {
    const plan = buildSession({ ...base, bank: bank(exercises), state: derive([]), size: 10 });
    expect(plan.some((p) => p.exercise_id.startsWith('new') && p.reason.code === 'new_topic')).toBe(true);
  });

  it('keeps old topics in review when they are due', () => {
    const history = [attempt({ date: '2026-11-01', result: 'correct', exercise: 'old0', skill: 's-old0' })];
    const plan = buildSession({ ...base, bank: bank(exercises), state: derive(history), size: 10 });
    expect(plan.find((p) => p.exercise_id === 'old0')?.reason.code).toBe('due');
  });

  it('puts exercises on recent mistakes first when Nomir has no active priorities', () => {
    const history = [attempt({ date: '2026-11-09', result: 'wrong', exercise: 'mid0', skill: 's-mid1' })];
    const plan = buildSession({ ...base, bank: bank(exercises), state: derive(history), size: 10 });
    expect(plan.find((p) => p.exercise_id === 'mid1')?.reason.code).toBe('recent_errors');
  });

  it("follows Nomir's priorities while they are active and shows his reason (A16)", () => {
    const rec: Recommendation = {
      recommendation_id: 'r1',
      scope: { type: 'skill', id: 's-old3' },
      weight: 1,
      reason: 'Ошибки в Dativ после mit',
      expires_at: '2026-12-01T00:00:00Z',
    };
    const plan = buildSession({ ...base, bank: bank(exercises), state: derive([]), size: 10, recommendations: [rec] });
    expect(plan.find((p) => p.exercise_id === 'old3')?.reason).toEqual({ code: 'nomir', text: 'Ошибки в Dativ после mit' });
  });

  it('limits one family per session while other material exists', () => {
    const same = Array.from({ length: 8 }, (_, i) => ex(`fam${i}`, { family_id: 'one', topic_ids: ['new'] }));
    const other = Array.from({ length: 8 }, (_, i) => ex(`oth${i}`, { topic_ids: ['old'] }));
    const plan = buildSession({ ...base, bank: bank([...same, ...other]), state: derive([]), size: 10 });
    expect(plan.filter((p) => p.exercise_id.startsWith('fam')).length).toBeLessThanOrEqual(config.max_per_family);
  });

  it('skips flagged and unpublished exercises', () => {
    const flagged: LearnerEvent = {
      event_id: uuid(),
      user_id: USER,
      device_id: 'd1',
      client_ts: '2026-11-01T10:00:00Z',
      type: 'exercise_flagged',
      payload: { flag_id: uuid(), bank_id: 'b', exercise_id: 'a', revision: 1 },
    };
    const plan = buildSession({
      ...base,
      bank: bank([ex('a'), ex('b', { status: 'retired' }), ex('c')]),
      state: derive([flagged]),
      size: 10,
    });
    expect(plan.map((p) => p.exercise_id)).toEqual(['c']);
  });

  it('filters by topic in free practice', () => {
    const plan = buildSession({ ...base, mode: 'practice', bank: bank(exercises), state: derive([]), size: 5, filter: { topic_ids: ['mid'] } });
    expect(plan).toHaveLength(5);
    expect(plan.every((p) => p.exercise_id.startsWith('mid') && p.reason.code === 'practice')).toBe(true);
  });

  it('splits short sessions without losing items to rounding', () => {
    for (const size of [1, 3, 5, 7, 10, 13]) {
      const q = quotas(size, config.weights);
      expect(q.weak + q.recent + q.due + q.variety).toBe(size);
    }
  });
});

describe('history and summary (A07)', () => {
  it('rebuilds sessions and a summary from the log alone', () => {
    const s = uuid();
    const events: LearnerEvent[] = [
      {
        event_id: uuid(),
        user_id: USER,
        device_id: 'd1',
        client_ts: '2026-11-01T09:59:00Z',
        type: 'session_started',
        payload: { session_id: s, bank_id: 'b', bank_version: 1, mode: 'recommended', size: 2, seed: 'x', plan: [], scheduler_version: 1 },
      },
      attempt({ date: '2026-11-01', result: 'correct', session: s }),
      attempt({ date: '2026-11-01', result: 'wrong', session: s, exercise: 'ex2', skill: 'other' }),
    ];
    const [record] = sessionHistory(events);
    expect(record?.attempts).toHaveLength(2);
    expect(record?.counts.independent).toBe(1);
    expect(summarize(events, { bank_id: 'b', config })).toMatchObject({ sessions: 1, attempts: 2, independent_correct: 1 });
  });
});
