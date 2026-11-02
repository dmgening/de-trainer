import { useMemo } from 'react';
import { createRng, shuffle, type AnswerSpec } from '@de-trainer/core';

type Spec = Extract<AnswerSpec, { type: 'choice' }>;

/** Tap an option to answer. Options are stored by ID, so the shuffle never changes what was answered. */
export function ChoiceAnswer(props: { spec: Spec; seed: string; selected: string | null; done: boolean; onSelect(id: string): void }) {
  const { spec, seed, selected, done } = props;
  const options = useMemo(() => (spec.shuffle ? shuffle(spec.options, createRng(seed)) : spec.options), [spec, seed]);
  return (
    <div className="options" role="group" aria-label="Варианты ответа">
      {options.map((o) => {
        const state = !done ? '' : spec.correct.includes(o.id) ? 'is-correct' : o.id === selected ? 'is-wrong' : '';
        return (
          <button
            key={o.id}
            type="button"
            data-option-id={o.id}
            lang="de"
            className={`option ${state} ${o.id === selected ? 'is-selected' : ''}`}
            aria-pressed={o.id === selected}
            disabled={done}
            onClick={() => props.onSelect(o.id)}
          >
            {o.text}
          </button>
        );
      })}
    </div>
  );
}
