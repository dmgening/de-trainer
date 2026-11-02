import { describe, expect, it } from 'vitest';
import { check, checkGap, expectedAnswer } from './check';
import { AnswerSpec, ContentPackage, Exercise, Gap } from './content';

const gap = (input: Partial<Gap> & { accept?: string[] }) => Gap.parse({ id: 'g1', mode: 'input', ...input });

describe('choice (A02)', () => {
  const spec = AnswerSpec.parse({
    type: 'choice',
    options: [
      { id: 'der', text: 'der' },
      { id: 'die', text: 'die' },
      { id: 'das', text: 'das' },
    ],
    correct: ['die'],
  });
  it('accepts the correct option by ID, so shuffling cannot change the meaning', () => {
    expect(check(spec, { type: 'choice', option_id: 'die' })).toEqual({ outcome: 'correct' });
  });
  it('rejects another option', () => {
    expect(check(spec, { type: 'choice', option_id: 'das' }).outcome).toBe('wrong');
  });
  it('rejects a response of another format', () => {
    expect(check(spec, { type: 'order', sequence: [] }).outcome).toBe('wrong');
  });
});

describe('gaps (A02)', () => {
  it('grades each gap separately', () => {
    const spec = AnswerSpec.parse({
      type: 'gaps',
      template: 'Ich trage ein{g1} rot{g2} Rock.',
      gaps: [
        { id: 'g1', mode: 'input', accept: ['en'] },
        { id: 'g2', mode: 'input', accept: ['en'] },
      ],
    });
    const result = check(spec, { type: 'gaps', values: { g1: 'en', g2: 'es' } });
    expect(result).toEqual({
      outcome: 'wrong',
      parts: [
        { id: 'g1', outcome: 'correct' },
        { id: 'g2', outcome: 'wrong' },
      ],
    });
  });

  it('checks chip gaps by option ID', () => {
    const g = gap({ mode: 'chips', options: [{ id: 'dem', text: 'dem' }, { id: 'den', text: 'den' }], correct: ['dem'] } as never);
    expect(checkGap(g, 'dem')).toBe('correct');
    expect(checkGap(g, 'den')).toBe('wrong');
  });

  it('treats an empty gap as wrong', () => {
    expect(checkGap(gap({ accept: ['der'] }), '  ')).toBe('wrong');
  });

  it('normalises Unicode, spaces and, by policy, case and punctuation', () => {
    const g = gap({ accept: ['in der Küche'] });
    expect(checkGap(g, '  In  der Küche. ')).toBe('correct');
    expect(checkGap(gap({ accept: ['Küche'], case: 'sensitive' }), 'küche')).toBe('wrong');
    expect(checkGap(gap({ accept: ['Ja.'], punctuation: 'strict' }), 'Ja')).toBe('wrong');
  });

  it('never replaces umlauts unless the exercise allows it', () => {
    expect(checkGap(gap({ accept: ['Straße'] }), 'Strasse')).toBe('wrong');
    expect(checkGap(gap({ accept: ['schön'] }), 'schoen')).toBe('wrong');
    expect(checkGap(gap({ accept: ['Straße'], umlaut_fallback: true }), 'Strasse')).toBe('correct');
    expect(checkGap(gap({ accept: ['schön'], umlaut_fallback: true }), 'schoen')).toBe('correct');
  });

  it('accepts listed alternatives', () => {
    const g = gap({ accept: ['der Sessel', 'der Stuhl'] });
    expect(checkGap(g, 'der Stuhl')).toBe('correct');
  });

  describe('near miss', () => {
    const g = gap({ accept: ['Kühlschrank'], near_miss: 'typo1' });
    it('marks one typo outside checked parts as almost', () => {
      expect(checkGap(g, 'Kühlschank')).toBe('near_miss');
      expect(checkGap(g, 'Kühlscrhank')).toBe('near_miss');
    });
    it('keeps umlaut errors as errors', () => {
      expect(checkGap(g, 'Kuhlschrank')).toBe('wrong');
    });
    it('keeps ending errors as errors', () => {
      expect(checkGap(gap({ accept: ['schönen'], near_miss: 'typo1' }), 'schöner')).toBe('wrong');
    });
    it('does not apply to short words such as articles', () => {
      expect(checkGap(gap({ accept: ['dem'], near_miss: 'typo1' }), 'den')).toBe('wrong');
    });
    it('is off by default', () => {
      expect(checkGap(gap({ accept: ['Kühlschrank'] }), 'Kühlschank')).toBe('wrong');
    });
    it('makes the whole answer almost, not correct', () => {
      const spec = AnswerSpec.parse({ type: 'gaps', template: '{g1} {g2}', gaps: [{ id: 'g1', mode: 'input', accept: ['der'] }, { id: 'g2', mode: 'input', accept: ['Kühlschrank'], near_miss: 'typo1' }] });
      expect(check(spec, { type: 'gaps', values: { g1: 'der', g2: 'Kühlschank' } }).outcome).toBe('near_miss');
    });
  });
});

describe('order (A02)', () => {
  const spec = AnswerSpec.parse({
    type: 'order',
    unit: 'word',
    tiles: [
      { id: 't1', text: 'ich' },
      { id: 't2', text: 'gehe' },
      { id: 't3', text: 'heute' },
      { id: 't4', text: 'einkaufen' },
    ],
    accept: [
      ['t1', 't2', 't3', 't4'],
      ['t3', 't2', 't1', 't4'],
    ],
  });
  it('accepts every listed order', () => {
    expect(check(spec, { type: 'order', sequence: ['t1', 't2', 't3', 't4'] }).outcome).toBe('correct');
    expect(check(spec, { type: 'order', sequence: ['t3', 't2', 't1', 't4'] }).outcome).toBe('correct');
  });
  it('rejects other orders and incomplete answers', () => {
    expect(check(spec, { type: 'order', sequence: ['t1', 't3', 't2', 't4'] }).outcome).toBe('wrong');
    expect(check(spec, { type: 'order', sequence: ['t1', 't2', 't3'] }).outcome).toBe('wrong');
  });
  it('treats tiles with the same text as interchangeable', () => {
    const dup = AnswerSpec.parse({
      type: 'order',
      unit: 'word',
      tiles: [
        { id: 'a', text: 'die' },
        { id: 'b', text: 'Frau' },
        { id: 'c', text: 'sieht' },
        { id: 'd', text: 'die' },
        { id: 'e', text: 'Katze' },
      ],
      accept: [['a', 'b', 'c', 'd', 'e']],
    });
    expect(check(dup, { type: 'order', sequence: ['d', 'b', 'c', 'a', 'e'] }).outcome).toBe('correct');
  });
  it('shows the first accepted order with a capitalised sentence start', () => {
    expect(expectedAnswer(spec).text).toBe('Ich gehe heute einkaufen');
  });
});

describe('answer spec validation', () => {
  it('requires template placeholders to match the gaps', () => {
    const bad = AnswerSpec.safeParse({ type: 'gaps', template: 'Ich {g1} {g3}', gaps: [{ id: 'g1', mode: 'input', accept: ['x'] }, { id: 'g2', mode: 'input', accept: ['y'] }] });
    expect(bad.success).toBe(false);
  });
  it('requires correct choices to exist', () => {
    expect(AnswerSpec.safeParse({ type: 'choice', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correct: ['c'] }).success).toBe(false);
  });
  it('requires every accepted order to use all tiles once', () => {
    const r = AnswerSpec.safeParse({ type: 'order', unit: 'word', tiles: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], accept: [['a', 'a']] });
    expect(r.success).toBe(false);
  });
});

describe('untrusted text (A15)', () => {
  const exercise = {
    exercise_id: 'x',
    revision: 1,
    family_id: 'f',
    status: 'published',
    topic_ids: ['t'],
    primary_skill_id: 's',
    prompt: 'Выберите',
    explanation: 'ok',
    answer_spec: { type: 'choice', options: [{ id: 'a', text: 'a' }, { id: 'b', text: 'b' }], correct: ['a'] },
  };
  it('refuses HTML and entities in any text field', () => {
    expect(Exercise.safeParse({ ...exercise, prompt: '<img src=x onerror=alert(1)>' }).success).toBe(false);
    expect(Exercise.safeParse({ ...exercise, explanation: 'a &lt; b' }).success).toBe(false);
    expect(Exercise.safeParse({ ...exercise, stimulus: { text: '<script>alert(1)</script>' } }).success).toBe(false);
  });
  it('refuses unknown fields such as raw HTML or external URLs', () => {
    expect(Exercise.safeParse({ ...exercise, html: '<b>x</b>' }).success).toBe(false);
    expect(Exercise.safeParse({ ...exercise, stimulus: { image_url: 'https://evil.example/x.svg' } }).success).toBe(false);
  });
  it('accepts plain German text with comparison signs written as words', () => {
    expect(Exercise.safeParse({ ...exercise, prompt: 'Wohin? → Akkusativ, 3 > 2' }).success).toBe(true);
  });
  it('refuses an unknown schema version with a clear message', () => {
    const r = ContentPackage.safeParse({ schema_version: 99, bank_id: 'b', package_id: 'p', package_version: 1, created_at: '2026-11-01T00:00:00Z', audience: 'owner', changelog: 'x' });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('Unsupported schema_version 99');
  });
});
