import { Fragment } from 'react';
import { PLACEHOLDER, type AnswerSpec, type PartOutcome } from '@de-trainer/core';

type Spec = Extract<AnswerSpec, { type: 'gaps' }>;

function split(template: string) {
  const parts: ({ text: string } | { gap: string })[] = [];
  let last = 0;
  for (const m of template.matchAll(PLACEHOLDER)) {
    if (m.index > last) parts.push({ text: template.slice(last, m.index) });
    parts.push({ gap: m[1]! });
    last = m.index + m[0].length;
  }
  if (last < template.length) parts.push({ text: template.slice(last) });
  return parts;
}

/** Fill one or more gaps: typed or chosen from chips; each gap is graded on its own. */
export function GapsAnswer(props: {
  spec: Spec;
  values: Record<string, string>;
  outcomes?: Record<string, PartOutcome>;
  expected?: Record<string, string>;
  done: boolean;
  onChange(values: Record<string, string>): void;
  onSubmit(): void;
}) {
  const { spec, values, outcomes, expected, done } = props;
  const set = (id: string, v: string) => props.onChange({ ...values, [id]: v });

  return (
    <div className="gaps">
      <p className="gap-text" lang="de">
        {split(spec.template).map((p, i) => {
          if ('text' in p) return <Fragment key={i}>{p.text}</Fragment>;
          const gap = spec.gaps.find((g) => g.id === p.gap)!;
          const outcome = outcomes?.[gap.id];
          const mark = outcome ? `is-${outcome.replace('_', '-')}` : '';
          const label = `Пропуск ${spec.gaps.indexOf(gap) + 1}`;
          if (gap.mode === 'input') {
            return (
              <span key={i} className="gap-slot">
                <input
                  className={`gap-input ${mark}`}
                  data-gap-id={gap.id}
                  aria-label={label}
                  value={values[gap.id] ?? ''}
                  size={Math.max(4, (values[gap.id] ?? '').length + 1, ...gap.accept.map((a) => Math.min(a.length + 1, 18)))}
                  maxLength={200}
                  disabled={done}
                  autoCapitalize="off"
                  autoCorrect="off"
                  autoComplete="off"
                  spellCheck={false}
                  enterKeyHint="done"
                  onChange={(e) => set(gap.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') props.onSubmit();
                  }}
                />
                {done && outcome !== 'correct' && expected?.[gap.id] && <span className="gap-expected">{expected[gap.id]}</span>}
              </span>
            );
          }
          return (
            <span key={i} className="gap-slot gap-chips" role="radiogroup" aria-label={label} data-gap-id={gap.id}>
              {gap.options.map((o) => {
                const chosen = values[gap.id] === o.id;
                const right = done && gap.correct.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    data-option-id={o.id}
                    role="radio"
                    aria-checked={chosen}
                    className={`chip ${chosen ? 'is-selected' : ''} ${chosen && done ? mark : ''} ${right ? 'is-correct' : ''}`}
                    disabled={done}
                    onClick={() => set(gap.id, o.id)}
                  >
                    {o.text}
                  </button>
                );
              })}
            </span>
          );
        })}
      </p>
    </div>
  );
}
