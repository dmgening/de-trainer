import { Fragment, useRef } from 'react';
import { PLACEHOLDER, type AnswerSpec, type PartOutcome } from '@de-trainer/core';

type Spec = Extract<AnswerSpec, { type: 'gaps' }>;
const GERMAN = ['ä', 'ö', 'ü', 'ß', 'Ä', 'Ö', 'Ü'];

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

/** Fill one or more gaps: typed (with German letters on screen) or chosen from chips; each gap is graded on its own. */
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
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focused = useRef<string | null>(spec.gaps.find((g) => g.mode === 'input')?.id ?? null);
  const set = (id: string, v: string) => props.onChange({ ...values, [id]: v });
  const hasInput = spec.gaps.some((g) => g.mode === 'input');

  const insert = (ch: string) => {
    const id = focused.current;
    const el = id ? inputs.current.get(id) : undefined;
    if (!id || !el) return;
    const v = values[id] ?? '';
    const start = el.selectionStart ?? v.length;
    const end = el.selectionEnd ?? v.length;
    set(id, v.slice(0, start) + ch + v.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + 1, start + 1);
    });
  };

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
                  ref={(el) => {
                    if (el) inputs.current.set(gap.id, el);
                  }}
                  className={`gap-input ${mark}`}
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
                  onFocus={() => (focused.current = gap.id)}
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
            <span key={i} className="gap-slot gap-chips" role="radiogroup" aria-label={label}>
              {gap.options.map((o) => {
                const chosen = values[gap.id] === o.id;
                const right = done && gap.correct.includes(o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
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
      {hasInput && !done && (
        <div className="german-keys" aria-label="Немецкие буквы">
          {GERMAN.map((ch) => (
            <button key={ch} type="button" className="key" onMouseDown={(e) => e.preventDefault()} onClick={() => insert(ch)}>
              {ch}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
