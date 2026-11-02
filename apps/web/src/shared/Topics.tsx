import { useMemo, useState, type ReactNode } from 'react';
import { localDate, type UnitState } from '@de-trainer/core';
import { useBackend } from './backend';
import { STATUS_LABEL, plural } from './labels';
import { useLearner } from './learner';
import { navigate } from './router';
import { startSession } from './session';

type Filter = 'all' | 'weak' | 'due';

function UnitLine({ title, unit, action }: { title: string; unit?: UnitState; action?: ReactNode }) {
  const status = unit?.status ?? 'no_data';
  const n = unit?.attempts ?? 0;
  return (
    <li className="unit">
      <span className="unit-title">{title}</span>
      {action}
      <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>
      <span className="muted unit-facts">
        {n === 0 ? 'ещё не было' : `${plural(n, 'наблюдение', 'наблюдения', 'наблюдений')}, сами — ${unit!.independent_successes}`}
        {n > 0 && n < 3 && ' (мало данных)'}
        {unit?.due_date && ` · повторить с ${new Date(`${unit.due_date}T00:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}`}
      </span>
    </li>
  );
}

/** Topics and skills with their state, the facts behind it, and free practice by topic or skill. */
export function Topics() {
  const b = useBackend();
  const l = useLearner();
  const [filter, setFilter] = useState<Filter>('all');
  const today = localDate(new Date());
  const topics = useMemo(() => [...(l.bank?.topics ?? [])].sort((a, c) => c.lesson_order - a.lesson_order), [l.bank]);

  const practice = async (filterBy: { topic_ids?: string[]; skill_ids?: string[] }) => {
    if (!l.bank || !l.state) return;
    const active = await startSession(b, { bank: l.bank, state: l.state, recommendations: l.recommendations, config: l.config, mode: 'practice', size: 10, filter: filterBy });
    if (active) navigate('train');
  };

  if (!l.bank || !l.state) return <p className="muted">Банк ещё не загружен.</p>;
  const state = l.state;
  const skillsOf = (topicId: string) => {
    const ids = new Set(l.bank!.exercises.filter((e) => e.status === 'published' && e.topic_ids.includes(topicId)).map((e) => e.primary_skill_id));
    for (const s of l.bank!.skills) if (s.topic_ids.includes(topicId)) ids.add(s.skill_id);
    return l.bank!.skills.filter((s) => ids.has(s.skill_id));
  };
  const keep = (u?: UnitState) => filter === 'all' || (filter === 'weak' ? u?.status === 'needs_practice' : !!u?.due_date && u.due_date <= today);

  return (
    <>
      <div className="size-picker" role="radiogroup" aria-label="Фильтр">
        {(
          [
            ['all', 'Все'],
            ['weak', 'Нужна практика'],
            ['due', 'Пора повторить'],
          ] as const
        ).map(([f, label]) => (
          <button key={f} type="button" role="radio" aria-checked={filter === f} className={`chip ${filter === f ? 'is-selected' : ''}`} onClick={() => setFilter(f)}>
            {label}
          </button>
        ))}
      </div>
      <p className="muted small">
        Статус считается по ответам в рекомендованных тренировках: «устойчиво» — успехи без подсказок в разные дни и на разных примерах. Свободная практика учитывается, но не двигает интервалы.
      </p>
      {topics.map((t) => {
        const skills = skillsOf(t.topic_id).filter((s) => keep(state.units[`skill:${s.skill_id}`]));
        if (filter !== 'all' && skills.length === 0) return null;
        return (
          <section key={t.topic_id} className="card topic">
            <div className="topic-head">
              <h2>{t.title}</h2>
              <button type="button" className="link-button" onClick={() => void practice({ topic_ids: [t.topic_id] })}>
                Практика
              </button>
            </div>
            <ul className="units">
              {skills.map((s) => (
                <UnitLine
                  key={s.skill_id}
                  title={s.title}
                  unit={state.units[`skill:${s.skill_id}`]}
                  action={
                    <button type="button" className="link-button small" onClick={() => void practice({ skill_ids: [s.skill_id] })} aria-label={`Практика: ${s.title}`}>
                      ▶
                    </button>
                  }
                />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
