import { useMemo } from 'react';
import { createRng, joinWords, shuffle, type AnswerSpec } from '@de-trainer/core';

type Spec = Extract<AnswerSpec, { type: 'order' }>;

/** Tap tiles to build the answer; tap a placed tile to take it back. No drag and drop needed. */
export function OrderAnswer(props: { spec: Spec; seed: string; sequence: string[]; done: boolean; onChange(seq: string[]): void }) {
  const { spec, sequence, done } = props;
  const pool = useMemo(() => shuffle(spec.tiles, createRng(props.seed)), [spec, props.seed]);
  const text = new Map(spec.tiles.map((t) => [t.id, t.text]));
  const isLine = spec.unit === 'line';
  const placed = sequence.map((id) => ({ id, text: text.get(id) ?? '' }));
  const preview = isLine ? null : joinWords(placed.map((p) => p.text));

  return (
    <div className={`order ${isLine ? 'order-lines' : 'order-words'}`}>
      <div className="order-answer" aria-label="Ваш ответ" aria-live="polite" lang="de">
        {placed.length === 0 && <span className="muted">Нажимайте на {isLine ? 'реплики' : 'слова'} по порядку</span>}
        {placed.map((p, i) => (
          <button
            key={p.id}
            type="button"
            className="tile is-placed"
            disabled={done}
            aria-label={`${i + 1}: ${p.text}. Убрать`}
            onClick={() => props.onChange(sequence.filter((id) => id !== p.id))}
          >
            {isLine ? `${i + 1}. ${p.text}` : i === 0 ? joinWords([p.text]) : p.text}
          </button>
        ))}
      </div>
      {!isLine && placed.length > 0 && <p className="order-preview" lang="de">{preview}</p>}
      {!done && (
        <div className="order-pool" role="group" aria-label={isLine ? 'Реплики' : 'Слова'} lang="de">
          {pool
            .filter((t) => !sequence.includes(t.id))
            .map((t) => (
              <button key={t.id} type="button" className="tile" onClick={() => props.onChange([...sequence, t.id])}>
                {t.text}
              </button>
            ))}
        </div>
      )}
      {!done && sequence.length > 0 && (
        <button type="button" className="link-button" onClick={() => props.onChange([])}>
          Начать заново
        </button>
      )}
    </div>
  );
}
