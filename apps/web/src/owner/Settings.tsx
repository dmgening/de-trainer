import { useEffect, useState } from 'react';
import type { BankVersionInfo } from '@de-trainer/core';
import { useBackend } from '../shared/backend';
import { formatDateTime, plural } from '../shared/labels';
import { useKv, useLearner } from '../shared/learner';
import { ApiFailure, api } from './api';
import { wipeLocalData } from './profile';

function SyncStatus({ onSync }: { onSync(): void }) {
  const sync = useKv('sync');
  const { pending } = useLearner();
  const label =
    sync?.state === 'syncing'
      ? 'Синхронизация…'
      : sync?.state === 'offline'
        ? 'Нет связи с сервером — всё сохраняется на устройстве'
        : sync?.state === 'auth'
          ? 'Нужно войти заново'
          : sync?.state === 'error'
            ? `Ошибка синхронизации: ${sync.message ?? ''}`
            : 'Синхронизировано';
  return (
    <section className="card" aria-labelledby="sync">
      <h2 id="sync">Синхронизация</h2>
      <p role="status">{label}</p>
      <p className="muted">
        {pending > 0 ? `Сохранено локально, ждут отправки: ${pending}. ` : 'Все ответы на сервере. '}
        {sync?.last_ok_at && `Последняя синхронизация: ${formatDateTime(sync.last_ok_at)}.`}
      </p>
      <div className="secondary-actions">
        <button type="button" className="button" onClick={onSync}>
          Синхронизировать
        </button>
        {sync?.state === 'auth' && (
          <a className="link-button" href="/auth/login">
            Войти
          </a>
        )}
      </div>
    </section>
  );
}

function Storage() {
  const [info, setInfo] = useState<{ usage?: number; quota?: number; persisted?: boolean } | null>(null);
  useEffect(() => {
    void (async () => {
      const est = await navigator.storage?.estimate?.();
      const persisted = await navigator.storage?.persisted?.();
      setInfo({ usage: est?.usage, quota: est?.quota, persisted });
    })();
  }, []);
  const mb = (n?: number) => (n === undefined ? '—' : `${(n / 1024 / 1024).toFixed(1)} МБ`);
  return (
    <section className="card">
      <h2>Хранилище на устройстве</h2>
      <p>
        Занято {mb(info?.usage)} из {mb(info?.quota)}. {info?.persisted ? 'Браузер не удалит данные сам.' : 'Браузер может очистить данные при нехватке места; тогда банк скачается заново, а неотправленные ответы пропадут.'}
      </p>
    </section>
  );
}

function Versions({ bankId, role, onChanged }: { bankId: string; role: string; onChanged(): void }) {
  const versions = useKv(`versions:${bankId}`) as BankVersionInfo[] | undefined;
  const current = useKv('current');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rollback = async (v: number) => {
    if (!window.confirm(`Откатить банк к версии ${v}? Будет создана новая версия с содержимым версии ${v}; история ответов не изменится.`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.rollback(bankId, v);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiFailure && err.kind === 'offline' ? 'Откат возможен только при связи с сервером.' : String((err as Error).message));
    } finally {
      setBusy(false);
    }
  };
  if (!versions?.length) return null;
  const head = versions[0]!.version;
  return (
    <section className="card" aria-labelledby="versions">
      <h2 id="versions">Версии банка</h2>
      <p className="muted">На устройстве версия {current?.[bankId] ?? '—'}, на сервере {head}.</p>
      <ol className="versions" reversed>
        {versions.map((v) => (
          <li key={v.version}>
            <b>v{v.version}</b> · {formatDateTime(v.created_at)} · {v.kind === 'rollback' ? `откат к v${v.rollback_to}` : v.created_by.replace(/^agent:/, '')}
            <br />
            {v.changelog}
            {role === 'owner' && v.version !== head && (
              <>
                {' '}
                <button type="button" className="link-button small" disabled={busy} onClick={() => void rollback(v.version)}>
                  Откатить к этой версии
                </button>
              </>
            )}
          </li>
        ))}
      </ol>
      {error && <p className="error">{error}</p>}
    </section>
  );
}

export function OwnerSettings(props: { onSync(): void; updateReady: boolean; onUpdate(): void }) {
  const b = useBackend();
  const l = useLearner();
  const profile = useKv('profile');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportAll = async () => {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportFile();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `de-class-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (err) {
      setError(err instanceof ApiFailure && err.kind === 'offline' ? 'Выгрузка делается с сервера: нужна сеть.' : (err as Error).message);
    } finally {
      setExporting(false);
    }
  };

  const logout = async () => {
    const pending = await b.db.events.where('synced').equals(0).count();
    const warning = pending
      ? `${plural(pending, 'ответ ещё не отправлен', 'ответа ещё не отправлены', 'ответов ещё не отправлены')} на сервер и пропадут. `
      : '';
    if (!window.confirm(`${warning}Выйти и удалить с этого устройства банк, журнал и картинки? Данные на сервере останутся.`)) return;
    const logoutUrl = profile?.logout_url ?? '/cdn-cgi/access/logout';
    await wipeLocalData(b.db, b.userId);
    window.location.replace(logoutUrl);
  };

  return (
    <>
      <SyncStatus onSync={props.onSync} />
      {props.updateReady && (
        <section className="card">
          <p>Доступна новая версия приложения.</p>
          <button type="button" className="button" disabled={!!l.active} onClick={props.onUpdate}>
            Обновить
          </button>
          {l.active && <p className="muted">Обновление после завершения тренировки.</p>}
        </section>
      )}
      {(profile?.banks ?? []).map((bank) => (
        <Versions key={bank.bank_id} bankId={bank.bank_id} role={bank.role} onChanged={props.onSync} />
      ))}
      <section className="card">
        <h2>Выгрузка</h2>
        <p className="muted">Полный журнал ответов, версии банка, приоритеты Номира и сводка в одном JSON-файле.</p>
        <button type="button" className="button" disabled={exporting} onClick={() => void exportAll()}>
          Скачать выгрузку
        </button>
        {error && <p className="error">{error}</p>}
      </section>
      <Storage />
      <section className="card">
        <h2>Аккаунт</h2>
        <p>{profile ? `${profile.display_name}${profile.email ? `, ${profile.email}` : ''}` : ''}</p>
        <button type="button" className="button button-danger" onClick={() => void logout()}>
          Выйти и удалить данные с устройства
        </button>
      </section>
    </>
  );
}
