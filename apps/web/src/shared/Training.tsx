import { useEffect, useMemo, useRef, useState } from 'react';
import {
  check,
  expectedAnswer,
  type AttemptResult,
  type BankSnapshot,
  type CheckResult,
  type Exercise,
  type LearnerState,
  type PlanItem,
  type Response,
} from '@de-trainer/core';
import { ChoiceAnswer } from './answers/Choice';
import { GapsAnswer } from './answers/Gaps';
import { OrderAnswer } from './answers/Order';
import { useBackend } from './backend';
import type { ActiveSession } from './db';
import { REASON_LABEL } from './labels';
import { useLearner, useSessionBank } from './learner';
import { navigate } from './router';
import { finishSession, flagExercise, recordAttempt } from './session';
import { StimulusView } from './Stimulus';

type Draft = { choice: string | null; gaps: Record<string, string>; order: string[] };

function responseOf(ex: Exercise, d: Draft): Response | null {
  switch (ex.answer_spec.type) {
    case 'choice':
      return d.choice ? { type: 'choice', option_id: d.choice } : null;
    case 'gaps':
      return { type: 'gaps', values: d.gaps };
    case 'order':
      return { type: 'order', sequence: d.order };
  }
}

function complete(ex: Exercise, d: Draft) {
  const spec = ex.answer_spec;
  if (spec.type === 'choice') return d.choice !== null;
  if (spec.type === 'gaps') return spec.gaps.every((g) => (d.gaps[g.id] ?? '').trim() !== '');
  return d.order.length === spec.tiles.length;
}

const OUTCOME_TEXT: Record<AttemptResult, string> = {
  correct: 'Верно!',
  near_miss: 'Почти: проверьте написание. Это не засчитывается как самостоятельный ответ.',
  wrong: 'Ошибка.',
  skipped: 'Пропущено.',
  revealed: 'Ответ показан.',
};

function Question(props: {
  active: ActiveSession;
  item: PlanItem;
  exercise: Exercise;
  bank: BankSnapshot;
  state: LearnerState;
  position: { n: number; total: number };
  onAnswering(): void;
  onNext(next: ActiveSession): void;
}) {
  const b = useBackend();
  const { exercise: ex, item, bank } = props;
  const [draft, setDraft] = useState<Draft>({ choice: null, gaps: {}, order: [] });
  const [hints, setHints] = useState(0);
  const [result, setResult] = useState<{ result: AttemptResult; check?: CheckResult; next: ActiveSession } | null>(null);
  const [flagging, setFlagging] = useState(false);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const startedAt = useRef(new Date());
  const feedbackRef = useRef<HTMLDivElement>(null);
  const expected = useMemo(() => expectedAnswer(ex.answer_spec), [ex]);
  const seed = `${props.active.session_id}:${props.position.n}`;

  useEffect(() => {
    if (result) feedbackRef.current?.focus();
  }, [result]);

  const submit = async (kind: 'check' | 'skip' | 'reveal', override?: Draft) => {
    if (busy || result) return;
    const d = override ?? draft;
    const response = kind === 'skip' ? null : responseOf(ex, d);
    let res: AttemptResult = kind === 'skip' ? 'skipped' : 'revealed';
    let chk: CheckResult | undefined;
    if (kind === 'check') {
      if (!response || !complete(ex, d)) return;
      chk = check(ex.answer_spec, response);
      res = chk.outcome;
    }
    setBusy(true);
    props.onAnswering();
    try {
      const next = await recordAttempt(b, {
        active: props.active,
        item,
        exercise: ex,
        bank,
        state: props.state,
        response: kind === 'skip' ? null : response,
        result: res,
        check: chk,
        hintsUsed: hints,
        startedAt: startedAt.current,
      });
      setResult({ result: res, check: chk, next });
    } finally {
      setBusy(false);
    }
  };

  const flag = async () => {
    const next = await flagExercise(b, ex, bank.bank_id, comment, result ? result.next : props.active);
    setFlagging(false);
    if (!result && next) props.onNext(next);
    else if (result && next) setResult({ ...result, next });
  };

  const spec = ex.answer_spec;
  const done = result !== null;
  const outcomes = result?.check?.parts ? Object.fromEntries(result.check.parts.map((p) => [p.id, p.outcome])) : undefined;
  const revealAll = done && result.result !== 'correct';

  return (
    <article className="question" aria-labelledby="prompt">
      <p className="progress">
        <span>
          {props.position.n} из {props.position.total}
        </span>
        <span className="reason">{item.reason.text ?? REASON_LABEL[item.reason.code]}</span>
      </p>
      <h2 id="prompt" className="prompt">
        {ex.prompt}
      </h2>
      <StimulusView stimulus={ex.stimulus} bank={bank} />

      {spec.type === 'choice' && (
        <ChoiceAnswer
          spec={spec}
          seed={seed}
          selected={draft.choice}
          done={done}
          onSelect={(id) => {
            const d = { ...draft, choice: id };
            setDraft(d);
            void submit('check', d);
          }}
        />
      )}
      {spec.type === 'gaps' && (
        <GapsAnswer
          spec={spec}
          values={draft.gaps}
          outcomes={outcomes ?? (revealAll ? Object.fromEntries(spec.gaps.map((g) => [g.id, 'wrong' as const])) : undefined)}
          expected={expected.gaps}
          done={done}
          onChange={(gaps) => setDraft({ ...draft, gaps })}
          onSubmit={() => void submit('check')}
        />
      )}
      {spec.type === 'order' && <OrderAnswer spec={spec} seed={seed} sequence={draft.order} done={done} onChange={(order) => setDraft({ ...draft, order })} />}

      {hints > 0 && !done && (
        <ul className="hints" aria-live="polite">
          {ex.hints.slice(0, hints).map((h, i) => (
            <li key={i}>{h}</li>
          ))}
        </ul>
      )}

      {!done && (
        <div className="actions">
          {spec.type !== 'choice' && (
            <button type="button" className="button" disabled={!complete(ex, draft) || busy} onClick={() => void submit('check')}>
              Проверить
            </button>
          )}
          <div className="secondary-actions">
            {hints < ex.hints.length && (
              <button type="button" className="link-button" onClick={() => setHints(hints + 1)}>
                Подсказка
              </button>
            )}
            <button type="button" className="link-button" onClick={() => void submit('reveal')}>
              Показать ответ
            </button>
            <button type="button" className="link-button" onClick={() => void submit('skip')}>
              Пропустить
            </button>
          </div>
        </div>
      )}

      {done && (
        <div className={`feedback is-${result.result.replace('_', '-')}`} ref={feedbackRef} tabIndex={-1} role="status" aria-live="polite">
          <p className="feedback-title">{OUTCOME_TEXT[result.result]}</p>
          {result.result !== 'correct' && (
            <p className="feedback-answer" lang="de">
              {result.result === 'near_miss' ? 'Правильно: ' : 'Ответ: '}
              <b>{expected.text}</b>
            </p>
          )}
          {hints > 0 && result.result === 'correct' && <p className="muted">С подсказкой — засчитано как практика.</p>}
          <p className="explanation">{ex.explanation}</p>
          <button type="button" className="button" autoFocus onClick={() => props.onNext(result.next)}>
            Дальше
          </button>
        </div>
      )}

      {flagging ? (
        <div className="flag-form">
          <label htmlFor="flag-comment">Что не так с заданием? (необязательно)</label>
          <textarea id="flag-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />
          <p className="muted">Задание перестанет выдаваться, пока Номир его не проверит.</p>
          <div className="secondary-actions">
            <button type="button" className="button" onClick={() => void flag()}>
              Отметить спорным
            </button>
            <button type="button" className="link-button" onClick={() => setFlagging(false)}>
              Отмена
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="link-button flag-link" onClick={() => setFlagging(true)}>
          Спорное задание?
        </button>
      )}
    </article>
  );
}

export function Training() {
  const b = useBackend();
  const { active, state, loading } = useLearner();
  const bank = useSessionBank(active);
  // The stored index moves on as soon as an answer is saved; the screen holds the answered
  // question while its feedback is shown, and never goes back to an earlier one.
  const [view, setView] = useState<{ sid: string; hold?: number; min: number } | null>(null);
  const v = active && view?.sid === active.session_id ? view : null;
  const index = v?.hold ?? Math.max(active?.index ?? 0, v?.min ?? 0);
  const finishing = useRef<string | null>(null);

  const finish = async (s: ActiveSession) => {
    if (finishing.current === s.session_id) return;
    finishing.current = s.session_id;
    await finishSession(b, s, false);
    navigate(`summary/${s.session_id}`, true);
  };
  const advance = (next: ActiveSession) => {
    if (next.index >= next.queue.length) void finish(next);
    else setView({ sid: next.session_id, min: next.index });
  };

  // The app was closed after the last answer: finish the session on the next visit.
  const exhausted = !!active && !active.queue[index];
  useEffect(() => {
    if (exhausted && active) void finish(active);
  });

  if (loading || bank === undefined) return <p className="muted">Загрузка…</p>;
  if (!active || !bank || !state) {
    return (
      <div className="card">
        <p>Активной тренировки нет.</p>
        <a className="button" href="#/">
          На главную
        </a>
      </div>
    );
  }
  const item = active.queue[index];
  if (!item) return null;
  const exercise = bank.exercises.find((e) => e.exercise_id === item.exercise_id);
  if (!exercise) {
    return (
      <div className="card">
        <p>Задание {item.exercise_id} недоступно в этой версии банка.</p>
        <button
          type="button"
          className="button"
          onClick={() => {
            const next = { ...active, index: index + 1 };
            void b.db.put('active_session', next).then(() => advance(next));
          }}
        >
          Дальше
        </button>
      </div>
    );
  }
  return (
    <>
      <Question
        key={`${active.session_id}:${index}`}
        active={active}
        item={item}
        exercise={exercise}
        bank={bank}
        state={state}
        position={{ n: index + 1, total: active.queue.length }}
        onAnswering={() => setView({ sid: active.session_id, hold: index, min: index })}
        onNext={advance}
      />
      <button
        type="button"
        className="link-button end-session"
        onClick={() => {
          if (!window.confirm('Завершить тренировку? Отвеченные задания сохранятся.')) return;
          void finishSession(b, active, true).then(() => navigate(`summary/${active.session_id}`, true));
        }}
      >
        Завершить досрочно
      </button>
    </>
  );
}
