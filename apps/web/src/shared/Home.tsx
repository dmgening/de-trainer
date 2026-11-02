import { useState, type ReactNode } from 'react';
import { localDate, type BankVersionInfo } from '@de-trainer/core';
import { useBackend } from './backend';
import { plural } from './labels';
import { useKv, useLearner, type Learner } from './learner';
import { navigate } from './router';
import { startSession } from './session';

const SIZES = [5, 10, 15, 20];

/** Why the next session looks the way it does, in the learner's words (PRD §7.3). */
function reasons(l: Learner): string[] {
  const out: string[] = [];
  for (const r of l.recommendations) if (!out.includes(r.reason)) out.push(r.reason);
  if (!l.state || !l.bank) return out.slice(0, 4);
  const units = Object.values(l.state.units);
  const weak = units.filter((u) => u.status === 'needs_practice').length;
  const today = localDate(new Date());
  const due = units.filter((u) => u.due_date && u.due_date <= today).length;
  const seenTopics = new Set(l.bank.exercises.filter((e) => l.state!.exercise_last_seen[e.exercise_id]).flatMap((e) => e.topic_ids));
  const fresh = l.bank.topics.filter((t) => !seenTopics.has(t.topic_id));
  if (l.recommendations.length === 0 && weak > 0) out.push(`Ошибки в последних попытках: ${plural(weak, 'навык', 'навыка', 'навыков')}`);
  if (due > 0) out.push(`Пора повторить: ${plural(due, 'элемент', 'элемента', 'элементов')}`);
  if (fresh.length > 0) out.push(`Новые темы: ${fresh.map((t) => t.title).join(', ')}`);
  return out.slice(0, 4);
}

function WhatsNew({ bankId }: { bankId: string }) {
  const { db } = useBackend();
  const versions = useKv(`versions:${bankId}`) as BankVersionInfo[] | undefined;
  const seen = useKv(`seen_version:${bankId}`) as number | undefined;
  if (!versions?.length) return null;
  const fresh = versions.filter((v) => v.version > (seen ?? 0));
  if (fresh.length === 0) return null;
  return (
    <section className="card whats-new" aria-labelledby="whats-new">
      <h2 id="whats-new">Что нового</h2>
      {fresh.slice(0, 3).map((v) => (
        <p key={v.version}>
          <b>Версия {v.version}.</b> {v.changelog}
          <span className="muted"> {v.diff.added.length > 0 && `+${v.diff.added.length}`} {v.diff.changed.length > 0 && `~${v.diff.changed.length}`} {v.diff.retired.length > 0 && `−${v.diff.retired.length}`}</span>
        </p>
      ))}
      <button type="button" className="link-button" onClick={() => void db.put(`seen_version:${bankId}`, versions[0]!.version)}>
        Понятно
      </button>
    </section>
  );
}

export function Home({ banner, emptyBank }: { banner?: ReactNode; emptyBank: ReactNode }) {
  const b = useBackend();
  const l = useLearner();
  const [size, setSize] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = size ?? l.config.default_session_size;

  const start = async () => {
    if (!l.bank || !l.state) return;
    const active = await startSession(b, { bank: l.bank, state: l.state, recommendations: l.recommendations, config: l.config, mode: 'recommended', size: chosen });
    if (active) navigate('train');
    else setError('Нет доступных заданий: все сняты или отмечены спорными.');
  };

  if (l.loading) return <p className="muted">Загрузка…</p>;
  return (
    <>
      {banner}
      {!l.bank ? (
        emptyBank
      ) : (
        <>
          {l.active ? (
            <section className="card">
              <p>
                Тренировка не закончена: {Math.min(l.active.index, l.active.queue.length)} из {l.active.queue.length}.
              </p>
              <a className="button" href="#/train">
                Продолжить
              </a>
            </section>
          ) : (
            <section className="card start" aria-labelledby="start">
              <h2 id="start">Тренировка</h2>
              <div className="size-picker" role="radiogroup" aria-label="Количество заданий">
                {SIZES.map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={chosen === n} className={`chip ${chosen === n ? 'is-selected' : ''}`} onClick={() => setSize(n)}>
                    {n}
                  </button>
                ))}
              </div>
              <button type="button" className="button button-wide" onClick={() => void start()}>
                Начать: {plural(chosen, 'задание', 'задания', 'заданий')}
              </button>
              {error && <p className="error">{error}</p>}
              {reasons(l).length > 0 && (
                <ul className="reasons" aria-label="Почему эти задания">
                  {reasons(l).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {l.bankId && <WhatsNew bankId={l.bankId} />}
        </>
      )}
    </>
  );
}
