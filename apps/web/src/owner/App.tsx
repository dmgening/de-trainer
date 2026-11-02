import { useEffect, useState } from 'react';
import { ROUTES } from '@de-trainer/core';
import { fetchMe, type MeResult } from './api';

type State = MeResult | { kind: 'loading' };

function signIn() {
  window.location.assign(`${ROUTES.auth}/login`);
}

function Status({ state }: { state: State }) {
  switch (state.kind) {
    case 'loading':
      return <p className="muted">Загрузка…</p>;
    case 'signed-in':
      return (
        <>
          <p>
            Вы вошли как <strong>{state.me.display_name}</strong> ({state.me.email}).
          </p>
          <p className="muted">
            Банков: {state.me.banks.length} · схема v{state.me.schema_version}
          </p>
          <p className="muted">Тренировки появятся в следующей версии.</p>
        </>
      );
    case 'signed-out':
      return (
        <>
          <p>Чтобы заниматься, войдите.</p>
          <button type="button" className="button" onClick={signIn}>
            Войти через Google
          </button>
        </>
      );
    case 'forbidden':
      return (
        <>
          <p>Этот аккаунт не подключён к приложению.</p>
          <a href="/cdn-cgi/access/logout">Войти другим аккаунтом</a>
        </>
      );
    case 'offline':
      return <p>Нет сети. Проверьте подключение и откройте приложение снова.</p>;
    case 'error':
      return <p>Не удалось связаться с сервером: {state.message}</p>;
  }
}

export default function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void fetchMe().then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="page">
      <header className="header">
        <h1>de-class</h1>
        <p className="subtitle">Тренажёр немецкого</p>
      </header>
      <section className="card" aria-live="polite">
        <Status state={state} />
      </section>
      <footer>
        <a href={ROUTES.demo}>Открыть демо</a>
      </footer>
    </main>
  );
}
