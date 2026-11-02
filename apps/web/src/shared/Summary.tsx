import { useMemo } from 'react';
import { sessionHistory } from '@de-trainer/core';
import { plural } from './labels';
import { useLearner } from './learner';

/** End of a session: independent answers, mistakes, skills practised and what happens next. */
export function Summary({ sessionId }: { sessionId: string }) {
  const l = useLearner();
  const record = useMemo(() => sessionHistory(l.events).find((s) => s.session_id === sessionId), [l.events, sessionId]);
  if (l.loading) return <p className="muted">Загрузка…</p>;
  if (!record) return <p className="muted">Сессия не найдена.</p>;
  const skillTitle = (id: string) => l.bank?.skills.find((s) => s.skill_id === id)?.title ?? id;
  const wrongSkills = [...new Set(record.attempts.filter((a) => a.payload.result === 'wrong' || a.payload.result === 'revealed').map((a) => a.payload.primary_skill_id))];
  const practised = [...new Set(record.attempts.map((a) => a.payload.primary_skill_id))];
  const c = record.counts;
  return (
    <>
      <section className="card" aria-labelledby="summary">
        <h2 id="summary">Итоги</h2>
        <dl className="stats">
          <div>
            <dt>Сами, без подсказок</dt>
            <dd>{c.independent}</dd>
          </div>
          <div>
            <dt>Ошибки</dt>
            <dd>{c.wrong}</dd>
          </div>
          <div>
            <dt>Почти</dt>
            <dd>{c.near_miss}</dd>
          </div>
          <div>
            <dt>Пропуски и показанные ответы</dt>
            <dd>{c.skipped + c.revealed}</dd>
          </div>
        </dl>
        <p className="muted">
          Всего {plural(record.attempts.length, 'ответ', 'ответа', 'ответов')}
          {record.abandoned ? ', тренировка завершена досрочно' : ''}.
        </p>
      </section>
      {wrongSkills.length > 0 && (
        <section className="card">
          <h3>Над чем поработать</h3>
          <ul>
            {wrongSkills.map((id) => (
              <li key={id}>{skillTitle(id)}</li>
            ))}
          </ul>
          <p className="muted">Эти навыки вернутся в следующих тренировках, по возможности на других примерах.</p>
        </section>
      )}
      <section className="card">
        <h3>Навыки в этой тренировке</h3>
        <ul>
          {practised.map((id) => (
            <li key={id}>{skillTitle(id)}</li>
          ))}
        </ul>
      </section>
      <div className="secondary-actions">
        <a className="button" href="#/">
          На главную
        </a>
        <a className="link-button" href={`#/history/${sessionId}`}>
          Разбор ответов
        </a>
      </div>
    </>
  );
}
