import { useEffect, useMemo, useRef, useState } from 'react';
import { uuidv7, type MeResponse } from '@de-trainer/core';
import { BackendContext, type Backend } from '../shared/backend';
import { LocalDb, type Profile } from '../shared/db';
import { formatDateTime } from '../shared/labels';
import { useKv, useLearner } from '../shared/learner';
import { Shell } from '../shared/Shell';
import { api, fetchMe, mediaPath } from './api';
import { currentProfileId, ownerDbName, setProfileId, wipeLocalData } from './profile';
import { OwnerSettings } from './Settings';
import { mediaCacheName, startSync } from './sync';

type Ready = { db: LocalDb; userId: string; deviceId: string };
type Phase =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'forbidden' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string }
  | ({ kind: 'ready' } & Ready);

const toProfile = (me: MeResponse): Profile => ({
  user_id: me.user_id,
  display_name: me.display_name,
  email: me.email,
  logout_url: me.logout_url,
  banks: me.banks,
});

async function openProfile(userId: string): Promise<Ready> {
  const db = new LocalDb(ownerDbName(userId));
  await db.open();
  let deviceId = await db.get('device_id');
  if (!deviceId) {
    deviceId = uuidv7();
    await db.put('device_id', deviceId);
  }
  return { db, userId, deviceId };
}

/**
 * Offline first: with a profile on the device the app opens straight from IndexedDB and checks
 * the Access session in the background. Without one, the first sign-in needs the network.
 */
async function boot(): Promise<Phase> {
  const stored = currentProfileId();
  if (stored) {
    const ready = await openProfile(stored);
    void fetchMe().then(async (r) => {
      if (r.kind === 'signed-in' && r.me.user_id !== stored) {
        // Another account signed in on this browser: keep nothing of the previous one unless it has unsent answers.
        if ((await ready.db.events.where('synced').equals(0).count()) === 0) await wipeLocalData(ready.db, stored);
        setProfileId(r.me.user_id);
        window.location.reload();
      } else if (r.kind === 'signed-in') {
        await ready.db.put('profile', toProfile(r.me));
      } else if (r.kind === 'signed-out' || r.kind === 'forbidden') {
        await ready.db.put('sync', { state: 'auth', message: r.kind === 'forbidden' ? 'Нет доступа' : undefined });
      }
    });
    return { kind: 'ready', ...ready };
  }
  const r = await fetchMe();
  if (r.kind !== 'signed-in') return r;
  setProfileId(r.me.user_id);
  const ready = await openProfile(r.me.user_id);
  await ready.db.put('profile', toProfile(r.me));
  // Ask the browser not to evict the offline bank and log (PRD §11.1).
  await navigator.storage?.persist?.().catch(() => false);
  return { kind: 'ready', ...ready };
}

function SyncLine() {
  const sync = useKv('sync');
  const { pending } = useLearner();
  if (sync?.state === 'auth') {
    return (
      <p className="banner" role="status">
        Сессия входа истекла. Тренироваться можно дальше, ответы сохраняются на устройстве. <a href="/auth/login">Войти заново</a>
      </p>
    );
  }
  const last = sync?.last_ok_at ? `синхронизировано ${formatDateTime(sync.last_ok_at)}` : 'ещё не синхронизировано';
  const state = sync?.state === 'offline' ? 'нет связи' : sync?.state === 'error' ? 'ошибка синхронизации' : sync?.state === 'syncing' ? 'синхронизация…' : null;
  return (
    <p className="sync-line muted" role="status">
      {[state, pending > 0 ? `на устройстве ${pending} неотправленных` : null, last].filter(Boolean).join(' · ')}
    </p>
  );
}

function EmptyBank() {
  const sync = useKv('sync');
  return (
    <section className="card">
      {sync?.last_ok_at ? (
        <p>Банк пока пуст: Номир ещё не опубликовал задания.</p>
      ) : (
        <p>Скачиваю банк заданий… Для первой загрузки нужна сеть.</p>
      )}
      <a href="/demo/">Посмотреть демо</a>
    </section>
  );
}

function ReadyApp({ ready, updateReady, onUpdate }: { ready: Ready; updateReady: boolean; onUpdate(): void }) {
  const sync = useRef<ReturnType<typeof startSync> | null>(null);
  useEffect(() => {
    sync.current = startSync(ready.db, ready.userId);
    return () => sync.current?.stop();
  }, [ready]);

  const backend = useMemo<Backend>(
    () => ({
      kind: 'owner',
      ...ready,
      onWrite: () => sync.current?.soon(),
      async mediaUrl(m) {
        const cache = await caches.open(mediaCacheName(ready.userId));
        let res = await cache.match(mediaPath(m.sha256));
        if (!res) {
          try {
            res = await api.media(m.sha256);
            await cache.put(mediaPath(m.sha256), res.clone());
          } catch {
            return null;
          }
        }
        return URL.createObjectURL(await res.blob());
      },
    }),
    [ready],
  );

  return (
    <BackendContext.Provider value={backend}>
      <Shell
        title="de-class"
        banner={<SyncLine />}
        emptyBank={<EmptyBank />}
        settings={<OwnerSettings onSync={() => void sync.current?.now()} updateReady={updateReady} onUpdate={onUpdate} />}
      />
    </BackendContext.Provider>
  );
}

function Gate({ children }: { children: React.ReactNode }) {
  return (
    <main className="page">
      <header className="header">
        <h1>de-class</h1>
        <p className="subtitle">Тренажёр немецкого по материалам занятий</p>
      </header>
      {children}
    </main>
  );
}

export default function App() {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [updateReady, setUpdateReady] = useState(false);
  const update = useRef<((reload?: boolean) => Promise<void>) | null>(null);

  useEffect(() => {
    // A page restored from the back/forward cache after logout must not show personal data (A10).
    const onShow = (e: PageTransitionEvent) => e.persisted && window.location.reload();
    window.addEventListener('pageshow', onShow);
    if ('serviceWorker' in navigator && import.meta.env.PROD) {
      void import('virtual:pwa-register').then(({ registerSW }) => {
        // The new worker waits for the learner's "Обновить": an update never interrupts a session (A14).
        update.current = registerSW({ onNeedRefresh: () => setUpdateReady(true) });
      });
    }
    void boot()
      .then(setPhase)
      .catch((err: unknown) => setPhase({ kind: 'error', message: String(err) }));
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  switch (phase.kind) {
    case 'loading':
      return (
        <Gate>
          <p className="muted">Загрузка…</p>
        </Gate>
      );
    case 'ready':
      return <ReadyApp ready={phase} updateReady={updateReady} onUpdate={() => void update.current?.(true)} />;
    case 'signed-out':
      return (
        <Gate>
          <section className="card">
            <p>Личные тренировки, история и прогресс доступны после входа.</p>
            <a className="button" href="/auth/login">
              Войти через Google
            </a>
          </section>
          <p>
            <a href="/demo/">Попробовать демо без входа</a>
          </p>
        </Gate>
      );
    case 'forbidden':
      return (
        <Gate>
          <p className="banner">Этот аккаунт не подключён к приложению.</p>
          <p>
            <a href="/cdn-cgi/access/logout">Выйти и войти другим аккаунтом</a> · <a href="/demo/">Демо</a>
          </p>
        </Gate>
      );
    case 'offline':
      return (
        <Gate>
          <p className="banner">Нет сети. Для первого входа на этом устройстве нужен интернет; дальше приложение работает офлайн.</p>
          <button type="button" className="button" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </Gate>
      );
    case 'error':
      return (
        <Gate>
          <p className="banner">Не удалось связаться с сервером: {phase.message}</p>
          <button type="button" className="button" onClick={() => window.location.reload()}>
            Повторить
          </button>
        </Gate>
      );
  }
}
