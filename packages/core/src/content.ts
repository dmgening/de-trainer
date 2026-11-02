import { z } from 'zod';
import { Id, IsoDateTime, Sha256, safeText } from './primitives';

/** Content schema version understood by this build; bumped when the package contract changes. */
export const SCHEMA_VERSION = 1;

export const LIMITS = {
  mediaBytes: 512 * 1024,
  mediaPixels: 2048,
  packageBytes: 5 * 1024 * 1024,
} as const;

const Revision = z.number().int().min(1);
const Priority = z.number().int().min(1).max(5).default(3);

/** Where the material came from. Personal locators stay inside owner banks. */
export const SourceRef = z.strictObject({
  doc: z.string().max(200).optional(),
  tab: z.string().max(200).optional(),
  anchor: z.string().max(200).optional(),
  lesson_date: z.string().max(20).optional(),
  scanned_at: IsoDateTime.optional(),
  note: safeText(500).optional(),
});

export const Topic = z.strictObject({
  topic_id: Id,
  revision: Revision,
  title: safeText(200),
  /** Larger means a more recent lesson; the date alone is not trusted (the year is often missing). */
  lesson_order: z.number().int().min(0),
  lesson_date: z.string().max(20).optional(),
  editorial_priority: Priority,
  source_refs: z.array(SourceRef).max(10).default([]),
});
export type Topic = z.infer<typeof Topic>;

export const Skill = z.strictObject({
  skill_id: Id,
  revision: Revision,
  title: safeText(200),
  description: safeText(1000).optional(),
  topic_ids: z.array(Id).max(20).default([]),
});
export type Skill = z.infer<typeof Skill>;

export const KnowledgeItem = z.strictObject({
  item_id: Id,
  revision: Revision,
  label: safeText(200),
  gloss: safeText(200).optional(),
  kind: z.enum(['word', 'verb', 'phrase', 'construction', 'form']),
  skill_ids: z.array(Id).max(10).default([]),
});
export type KnowledgeItem = z.infer<typeof KnowledgeItem>;

export const Option = z.strictObject({ id: Id, text: safeText(300) });
export type Option = z.infer<typeof Option>;

export const Stimulus = z.strictObject({
  text: safeText(2000).optional(),
  passage: z
    .strictObject({
      kind: z.enum(['text', 'dialogue']),
      title: safeText(200).optional(),
      lines: z.array(z.strictObject({ speaker: safeText(60).optional(), text: safeText(1000) })).min(1).max(40),
    })
    .optional(),
  media: z.strictObject({ media_id: Id, alt: safeText(300) }).optional(),
});
export type Stimulus = z.infer<typeof Stimulus>;

const gapCommon = {
  id: Id,
  /** Knowledge items this gap checks; the gap's own outcome is attributed to them. */
  knowledge_item_ids: z.array(Id).max(10).default([]),
};

export const InputGap = z.strictObject({
  ...gapCommon,
  mode: z.literal('input'),
  accept: z.array(safeText(200)).min(1).max(20),
  case: z.enum(['sensitive', 'insensitive']).default('insensitive'),
  punctuation: z.enum(['strict', 'ignore']).default('ignore'),
  /** Accept ae/oe/ue/ss for ä/ö/ü/ß. Off by default: umlauts are often the point of the exercise. */
  umlaut_fallback: z.boolean().default(false),
  /** typo1: one typo outside umlauts and the last two letters is "almost", not an error. */
  near_miss: z.enum(['off', 'typo1']).default('off'),
});

export const ChipsGap = z.strictObject({
  ...gapCommon,
  mode: z.literal('chips'),
  options: z.array(Option).min(2).max(6),
  correct: z.array(Id).min(1),
});

export const Gap = z.discriminatedUnion('mode', [InputGap, ChipsGap]);
export type Gap = z.infer<typeof Gap>;

export const ChoiceSpec = z.strictObject({
  type: z.literal('choice'),
  options: z.array(Option).min(2).max(6),
  correct: z.array(Id).min(1),
  shuffle: z.boolean().default(true),
});

export const GapsSpec = z.strictObject({
  type: z.literal('gaps'),
  /** Text with placeholders: "Ich trage ein{g1} rot{g2} Rock." */
  template: safeText(1000),
  gaps: z.array(Gap).min(1).max(12),
});

export const OrderSpec = z.strictObject({
  type: z.literal('order'),
  unit: z.enum(['word', 'line']),
  tiles: z.array(Option).min(2).max(20),
  /** Every accepted order, as tile IDs; each must use all tiles once. */
  accept: z.array(z.array(Id)).min(1).max(10),
});

export const PLACEHOLDER = /\{([A-Za-z0-9._:-]+)\}/g;

function uniqueIds(ids: string[]) {
  return new Set(ids).size === ids.length;
}

export const AnswerSpec = z.discriminatedUnion('type', [ChoiceSpec, GapsSpec, OrderSpec]).superRefine((spec, ctx) => {
  const issue = (message: string, path: (string | number)[] = []) => ctx.addIssue({ code: 'custom', message, path });
  if (spec.type === 'choice') {
    const ids = spec.options.map((o) => o.id);
    if (!uniqueIds(ids)) issue('Option IDs must be unique', ['options']);
    spec.correct.forEach((id, i) => ids.includes(id) || issue(`Unknown option ${id}`, ['correct', i]));
  } else if (spec.type === 'gaps') {
    const gapIds = spec.gaps.map((g) => g.id);
    if (!uniqueIds(gapIds)) issue('Gap IDs must be unique', ['gaps']);
    const placeholders = [...spec.template.matchAll(PLACEHOLDER)].map((m) => m[1]!);
    if (!uniqueIds(placeholders)) issue('Each gap appears in the template once', ['template']);
    if (placeholders.length !== gapIds.length || placeholders.some((p) => !gapIds.includes(p))) {
      issue('Template placeholders must match gap IDs exactly', ['template']);
    }
    spec.gaps.forEach((g, i) => {
      if (g.mode !== 'chips') return;
      const ids = g.options.map((o) => o.id);
      if (!uniqueIds(ids)) issue('Option IDs must be unique', ['gaps', i, 'options']);
      g.correct.forEach((id, j) => ids.includes(id) || issue(`Unknown option ${id}`, ['gaps', i, 'correct', j]));
    });
  } else {
    const ids = spec.tiles.map((t) => t.id);
    if (!uniqueIds(ids)) issue('Tile IDs must be unique', ['tiles']);
    const sorted = [...ids].sort().join('|');
    spec.accept.forEach((seq, i) => {
      if ([...seq].sort().join('|') !== sorted) issue('Each accepted order must use every tile once', ['accept', i]);
    });
  }
});
export type AnswerSpec = z.infer<typeof AnswerSpec>;
export type GapsSpec = z.infer<typeof GapsSpec>;

export const EXERCISE_STATUSES = ['draft', 'reviewed', 'published', 'retired'] as const;

export const Exercise = z.strictObject({
  exercise_id: Id,
  revision: Revision,
  family_id: Id,
  status: z.enum(EXERCISE_STATUSES),
  level: z.string().max(10).optional(),
  topic_ids: z.array(Id).min(1).max(5),
  primary_skill_id: Id,
  secondary_skill_ids: z.array(Id).max(10).default([]),
  knowledge_item_ids: z.array(Id).max(20).default([]),
  /** Instruction for the learner, in Russian. */
  prompt: safeText(500),
  stimulus: Stimulus.optional(),
  answer_spec: AnswerSpec,
  explanation: safeText(2000),
  hints: z.array(safeText(500)).max(5).default([]),
  editorial_priority: Priority,
  /** This revision fixes a wrong answer key: attempts on earlier revisions stop counting. */
  key_fix: z.boolean().default(false),
  source_refs: z.array(SourceRef).max(10).default([]),
});
export type Exercise = z.infer<typeof Exercise>;

export const OBJECT_KINDS = ['topic', 'skill', 'knowledge_item', 'exercise', 'media'] as const;
export const ObjectKind = z.enum(OBJECT_KINDS);
export type ObjectKind = z.infer<typeof ObjectKind>;

export const PackageMedia = z.strictObject({ media_id: Id, sha256: Sha256 });

export const ContentPackage = z
  .strictObject({
    schema_version: z.number().int(),
    bank_id: Id,
    package_id: Id,
    package_version: z.number().int().min(1),
    created_at: IsoDateTime,
    audience: z.enum(['owner', 'demo']),
    changelog: safeText(4000),
    topics: z.array(Topic).max(500).default([]),
    skills: z.array(Skill).max(1000).default([]),
    knowledge_items: z.array(KnowledgeItem).max(5000).default([]),
    exercises: z.array(Exercise).max(5000).default([]),
    media: z.array(PackageMedia).max(500).default([]),
    retire: z.array(z.strictObject({ kind: ObjectKind, id: Id })).max(5000).default([]),
  })
  .superRefine((pkg, ctx) => {
    if (pkg.schema_version !== SCHEMA_VERSION) {
      ctx.addIssue({
        code: 'custom',
        path: ['schema_version'],
        message: `Unsupported schema_version ${pkg.schema_version}; this server accepts ${SCHEMA_VERSION}`,
      });
    }
    // The demo is public: no workbook locators may leak into it.
    if (pkg.audience === 'demo') {
      const all = [...pkg.topics, ...pkg.exercises];
      all.forEach((o) => {
        if (o.source_refs.length > 0) {
          ctx.addIssue({ code: 'custom', path: ['audience'], message: 'Demo packages must not carry source_refs' });
        }
      });
    }
  });
export type ContentPackage = z.infer<typeof ContentPackage>;
export type ContentPackageInput = z.input<typeof ContentPackage>;

export const MediaInfo = z.strictObject({
  media_id: Id,
  sha256: Sha256,
  mime: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  bytes: z.number().int().min(1),
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type MediaInfo = z.infer<typeof MediaInfo>;

/** What a learner's device stores: one bank version, published exercises only. */
export const BankSnapshot = z.strictObject({
  schema_version: z.number().int(),
  bank_id: Id,
  version: z.number().int().min(1),
  created_at: IsoDateTime,
  topics: z.array(Topic),
  skills: z.array(Skill),
  knowledge_items: z.array(KnowledgeItem),
  /** Published exercises plus retired ones (status "retired"), kept so history can still show them. */
  exercises: z.array(Exercise),
  media: z.array(MediaInfo),
});
export type BankSnapshot = z.infer<typeof BankSnapshot>;
