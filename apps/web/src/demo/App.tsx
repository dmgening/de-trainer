import { useEffect, useMemo, useState } from 'react';
import { ContentPackage, snapshotFromPackage, uuidv7 } from '@de-trainer/core';
import { FIXTURE_MEDIA, demoPackage } from '@de-trainer/fixtures';
import { BackendContext, type Backend } from '../shared/backend';
import { LocalDb, applyDownloadedSnapshots, snapshotKey } from '../shared/db';
import { Shell } from '../shared/Shell';

// The demo lives in this browser only: its own database name, no API, no sync (PRD §4.2).
const DB_NAME = 'de-class:demo';
const USER_KEY = 'de-class:demo:user';
const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

async function boot(): Promise<{ db: LocalDb; userId: string; deviceId: string }> {
  let userId = localStorage.getItem(USER_KEY);
  if (!userId) {
    userId = uuidv7();
    localStorage.setItem(USER_KEY, userId);
  }
  const db = new LocalDb(DB_NAME);
  await db.open();
  let deviceId = await db.get('device_id');
  if (!deviceId) {
    deviceId = `demo-${uuidv7()}`;
    await db.put('device_id', deviceId);
  }
  const media = new Map(Object.values(FIXTURE_MEDIA).map(({ sha256, mime, bytes, width, height }) => [sha256, { mime, bytes, width, height }]));
  const snapshot = snapshotFromPackage(ContentPackage.parse(demoPackage), media);
  const key = snapshotKey(snapshot.bank_id, snapshot.version);
  if (!(await db.snapshots.get(key))) await db.snapshots.put({ key, bank_id: snapshot.bank_id, version: snapshot.version, snapshot });
  await db.put('downloaded', { [snapshot.bank_id]: snapshot.version });
  await db.put('profile', { user_id: userId, display_name: 'Гость', banks: [{ bank_id: snapshot.bank_id, title: 'Демо', role: 'learner' }] });
  await applyDownloadedSnapshots(db);
  return { db, userId, deviceId };
}

function DemoBanner() {
  return <p className="banner">Демо. Прогресс хранится только в этом браузере и может быть потерян при очистке данных.</p>;
}

function DemoSettings({ db }: { db: LocalDb }) {
  const reset = async () => {
    if (!window.confirm('Сбросить весь прогресс демо в этом браузере?')) return;
    db.close();
    await LocalDb.delete(DB_NAME);
    localStorage.removeItem(USER_KEY);
    window.location.replace(`${import.meta.env.BASE_URL}#/`);
    window.location.reload();
  };
  return (
    <>
      <section className="card">
        <h2>Прогресс демо</h2>
        <p>Ответы, история и состояние повторения хранятся только здесь и никуда не отправляются.</p>
        <button type="button" className="button button-danger" onClick={() => void reset()}>
          Сбросить прогресс
        </button>
      </section>
      <section className="card">
        <h2>О приложении</h2>
        <p>
          Это демонстрация тренажёра на авторских примерах. Личное приложение открывается после входа: <a href="/">de-class</a>.
        </p>
      </section>
    </>
  );
}

export default function App() {
  const [ready, setReady] = useState<Awaited<ReturnType<typeof boot>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void boot()
      .then(setReady)
      .catch((err: unknown) => setError(String(err)));
  }, []);

  const backend = useMemo<Backend | null>(
    () =>
      ready && {
        kind: 'demo',
        ...ready,
        onWrite: () => {},
        mediaUrl: async (m) => `${import.meta.env.BASE_URL}media/${m.sha256}.${EXT[m.mime] ?? 'bin'}`,
      },
    [ready],
  );

  if (error) return <p className="banner">Демо не запустилось: {error}</p>;
  if (!backend) return <p className="muted page">Загрузка…</p>;
  return (
    <BackendContext.Provider value={backend}>
      <Shell title="de-class · демо" banner={<DemoBanner />} emptyBank={<p>Демо-набор не загрузился.</p>} settings={<DemoSettings db={backend.db} />} />
    </BackendContext.Provider>
  );
}
