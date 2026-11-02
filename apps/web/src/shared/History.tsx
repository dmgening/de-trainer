import { useMemo } from 'react';
import { expectedAnswer, joinWords, sessionHistory, type EventOf, type Exercise } from '@de-trainer/core';
import { REASON_LABEL, RESULT_LABEL, formatDateTime, plural } from './labels';
import { useLearner } from './learner';

function describeResponse(a: EventOf<'attempt'>['payload'], ex?: Exercise): string {
  const r = a.response;
  if (!r) return '—';
  const spec = ex?.answer_spec;
  if (r.type === 'choice') return spec?.type === 'choice' ? (spec.options.find((o) => o.id === r.option_id)?.text ?? r.option_id) : r.option_id;
  if (r.type === 'gaps') {
    return Object.entries(r.values)
      .map(([id, v]) => (spec?.type === 'gaps' ? (spec.gaps.find((g) => g.id === id && g.mode === 'chips') as { options?: { id: string; text: string }[] } | undefined)?.options?.find((o) => o.id === v)?.text ?? v : v))
      .join(' · ');
  }
  const text = new Map(spec?.type === 'order' ? spec.tiles.map((t) => [t.id, t.text]) : []);
  const words = r.sequence.map((id) => text.get(id) ?? id);
  return spec?.type === 'order' && spec.unit === 'line' ? words.join(' / ') : joinWords(words);
}

/** Sessions and attempts. Old answers stay tied to the revision the learner saw. */
export function History({ sessionId }: { sessionId?: string }) {
  const l = useLearner();
  const sessions = useMemo(() => sessionHistory(l.events), [l.events]);
  if (l.loading) return <p className="muted">Загрузка…</p>;

  if (!sessionId) {
    if (sessions.length === 0) return <p className="muted">Тренировок пока не было.</p>;
    return (
      <ul className="session-list">
        {sessions.map((s) => (
          <li key={s.session_id}>
            <a href={`#/history/${s.session_id}`} className="card session-link">
              <span>
                {formatDateTime(s.started_at)} · {s.mode === 'practice' ? 'практика' : 'тренировка'}
                {s.finished_at === null && ' · не завершена'}
              </span>
              <span className="muted">
                {plural(s.attempts.length, 'ответ', 'ответа', 'ответов')}: сами — {s.counts.independent}, ошибки — {s.counts.wrong}
              </span>
            </a>
          </li>
        ))}
      </ul>
    );
  }

  const s = sessions.find((x) => x.session_id === sessionId);
  if (!s) return <p className="muted">Сессия не найдена.</p>;
  return (
    <>
      <p className="muted">
        {formatDateTime(s.started_at)} · {s.mode === 'practice' ? 'свободная практика' : 'рекомендованная тренировка'}
      </p>
      <ol className="attempts">
        {s.attempts.map((a) => {
          const p = a.payload;
          // The current bank may hold a newer revision; the attempt keeps the revision it was answered on.
          const ex = l.bank?.exercises.find((e) => e.exercise_id === p.exercise_id);
          const sameRevision = ex?.revision === p.exercise_revision;
          return (
            <li key={a.event_id} className={`card attempt is-${p.result.replace('_', '-')}`}>
              <p className="attempt-head">
                <b>{RESULT_LABEL[p.result]}</b>
                {p.hints_used > 0 && <span className="muted"> · подсказок: {p.hints_used}</span>}
                {p.retry && <span className="muted"> · {REASON_LABEL.retry}</span>}
              </p>
              <p>{ex ? ex.prompt : `Задание ${p.exercise_id}`}</p>
              {ex && !sameRevision && (
                <p className="muted">
                  Задание с тех пор изменено: вы отвечали на редакцию {p.exercise_revision}, сейчас {ex.revision}.
                </p>
              )}
              {ex?.stimulus?.text && <p lang="de">{ex.stimulus.text}</p>}
              <p lang="de">
                Ваш ответ: <b>{describeResponse(p, sameRevision ? ex : undefined)}</b>
              </p>
              {ex && p.result !== 'correct' && (
                <p lang="de">
                  Верно{sameRevision ? '' : ' (в текущей редакции)'}: <b>{expectedAnswer(ex.answer_spec).text}</b>
                </p>
              )}
              {ex?.status === 'retired' && <p className="muted">Задание снято из банка.</p>}
              {!ex && <p className="muted">Задания больше нет в банке.</p>}
            </li>
          );
        })}
      </ol>
    </>
  );
}
