import { z } from 'zod';
import { PLACEHOLDER, type AnswerSpec, type Gap } from './content';
import { Id } from './primitives';

/** Bumped whenever the checking rules change; stored with every attempt. */
export const CHECKER_VERSION = 1;

export const Response = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('choice'), option_id: Id }),
  /** Input gaps carry typed text, chip gaps carry the chosen option ID. */
  z.strictObject({ type: z.literal('gaps'), values: z.record(Id, z.string().max(300)) }),
  z.strictObject({ type: z.literal('order'), sequence: z.array(Id).max(20) }),
]);
export type Response = z.infer<typeof Response>;

export const PartOutcome = z.enum(['correct', 'near_miss', 'wrong']);
export type PartOutcome = z.infer<typeof PartOutcome>;

export type CheckResult = {
  outcome: PartOutcome;
  parts?: { id: string; outcome: PartOutcome }[];
};

type TextPolicy = { case: 'sensitive' | 'insensitive'; punctuation: 'strict' | 'ignore'; umlaut: boolean };

export function normalize(input: string, policy: TextPolicy): string {
  let s = input
    .normalize('NFC')
    .replace(/[’‘`´]/g, "'")
    .replace(/[„“”«»]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (policy.punctuation === 'ignore') s = s.replace(/[.,!?;:"'()…–—-]/g, '').replace(/\s+/g, ' ').trim();
  if (policy.case === 'insensitive') s = s.toLocaleLowerCase('de-DE');
  if (policy.umlaut) s = expandUmlauts(s);
  return s;
}

const expandUmlauts = (s: string) =>
  s
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/Ä/g, 'Ae')
    .replace(/Ö/g, 'Oe')
    .replace(/Ü/g, 'Ue')
    .replace(/ß/g, 'ss');

const stripUmlauts = (s: string) =>
  s.replace(/[äÄöÖüÜ]/g, (c) => ({ ä: 'a', Ä: 'A', ö: 'o', Ö: 'O', ü: 'u', Ü: 'U' })[c]!).replace(/ß/g, 's');

/** Optimal string alignment distance, capped: we only need to know whether it is exactly 1. */
function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 2;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

function commonSuffix(a: string, b: string) {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

/**
 * A typo is "almost" only when it cannot be the point of the exercise: never an umlaut or ß,
 * never in the last two letters (endings), never in short words (articles, pronouns).
 */
function isNearMiss(given: string, expected: string): boolean {
  if (expected.length < 5) return false;
  if (editDistance(given, expected) !== 1) return false;
  if (stripUmlauts(given) === stripUmlauts(expected) || expandUmlauts(given) === expandUmlauts(expected)) return false;
  return commonSuffix(given, expected) >= 2;
}

export function checkGap(gap: Gap, value: string | undefined): PartOutcome {
  if (value === undefined || value.trim() === '') return 'wrong';
  if (gap.mode === 'chips') return gap.correct.includes(value) ? 'correct' : 'wrong';
  const policy = { case: gap.case, punctuation: gap.punctuation, umlaut: gap.umlaut_fallback };
  const given = normalize(value, policy);
  const accepted = gap.accept.map((a) => normalize(a, policy));
  if (accepted.includes(given)) return 'correct';
  if (gap.near_miss === 'typo1') {
    const loose = { ...policy, umlaut: false };
    const g = normalize(value, loose);
    if (gap.accept.some((a) => isNearMiss(g, normalize(a, loose)))) return 'near_miss';
  }
  return 'wrong';
}

function combine(parts: PartOutcome[]): PartOutcome {
  if (parts.includes('wrong')) return 'wrong';
  if (parts.includes('near_miss')) return 'near_miss';
  return 'correct';
}

/** Pure and deterministic: the same spec and response give the same result on every device. */
export function check(spec: AnswerSpec, response: Response): CheckResult {
  if (spec.type !== response.type) return { outcome: 'wrong' };
  switch (spec.type) {
    case 'choice': {
      const r = response as Extract<Response, { type: 'choice' }>;
      return { outcome: spec.correct.includes(r.option_id) ? 'correct' : 'wrong' };
    }
    case 'gaps': {
      const r = response as Extract<Response, { type: 'gaps' }>;
      const parts = spec.gaps.map((g) => ({ id: g.id, outcome: checkGap(g, r.values[g.id]) }));
      return { outcome: combine(parts.map((p) => p.outcome)), parts };
    }
    case 'order': {
      const r = response as Extract<Response, { type: 'order' }>;
      // Compare texts, not IDs: two tiles with the same word are interchangeable.
      const text = new Map(spec.tiles.map((t) => [t.id, t.text.normalize('NFC').trim()]));
      const given = r.sequence.map((id) => text.get(id) ?? `\u0000${id}`).join('\u0001');
      const ok = r.sequence.length === spec.tiles.length && spec.accept.some((seq) => seq.map((id) => text.get(id)).join('\u0001') === given);
      return { outcome: ok ? 'correct' : 'wrong' };
    }
  }
}

/** Word tiles are stored in lower case where the position decides the case: the sentence start is capitalised on display. */
export function joinWords(words: string[]): string {
  const text = words.join(' ').replace(/ ([.,!?;:])/g, '$1');
  return text.charAt(0).toLocaleUpperCase('de-DE') + text.slice(1);
}

/** Human-readable correct answer, for feedback after a mistake, a reveal or a near miss. */
export function expectedAnswer(spec: AnswerSpec): { text: string; gaps?: Record<string, string> } {
  switch (spec.type) {
    case 'choice':
      return { text: spec.options.filter((o) => spec.correct.includes(o.id)).map((o) => o.text).join(' / ') };
    case 'gaps': {
      const gaps: Record<string, string> = {};
      for (const g of spec.gaps) {
        gaps[g.id] = g.mode === 'input' ? g.accept[0]! : g.options.find((o) => o.id === g.correct[0])!.text;
      }
      return { text: spec.template.replace(PLACEHOLDER, (_, id: string) => gaps[id] ?? ''), gaps };
    }
    case 'order': {
      const text = new Map(spec.tiles.map((t) => [t.id, t.text]));
      const seq = spec.accept[0]!.map((id) => text.get(id) ?? '');
      return { text: spec.unit === 'word' ? joinWords(seq) : seq.join('\n') };
    }
  }
}
