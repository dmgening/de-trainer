import {
  BankSnapshot,
  BankVersionsResponse,
  MeResponse,
  PublishResponse,
  ROUTES,
  SyncPullResponse,
  SyncPushResponse,
  type ClientEvent,
} from '@de-trainer/core';
import type { z } from 'zod';

export type MeResult =
  | { kind: 'signed-in'; me: MeResponse }
  | { kind: 'signed-out' }
  | { kind: 'forbidden' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

/** Signals the sync loop understands: no network, sign-in needed, or a server-side refusal. */
export class ApiFailure extends Error {
  constructor(
    readonly kind: 'offline' | 'auth' | 'forbidden' | 'error',
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    // An expired Access session answers with a redirect to the Access login page.
    // Keep it as a signal instead of following it cross-origin.
    res = await fetch(`${ROUTES.api}${path}`, {
      ...init,
      redirect: 'manual',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    });
  } catch {
    throw new ApiFailure('offline', 'Нет сети');
  }
  if (res.type === 'opaqueredirect' || res.status === 401) throw new ApiFailure('auth', 'Нужно войти заново', res.status);
  if (res.status === 403) throw new ApiFailure('forbidden', 'Нет доступа', 403);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    throw new ApiFailure('error', body?.error?.message ?? `HTTP ${res.status}`, res.status);
  }
  return res;
}

async function json<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
  const parsed = schema.safeParse(await (await request(path, init)).json());
  if (!parsed.success) throw new ApiFailure('error', 'Неожиданный ответ сервера');
  return parsed.data;
}

export async function fetchMe(): Promise<MeResult> {
  try {
    return { kind: 'signed-in', me: await json(MeResponse, '/me') };
  } catch (err) {
    if (!(err instanceof ApiFailure)) throw err;
    if (err.kind === 'auth') return { kind: 'signed-out' };
    if (err.kind === 'forbidden') return { kind: 'forbidden' };
    if (err.kind === 'offline') return { kind: 'offline' };
    return { kind: 'error', message: err.message };
  }
}

export const api = {
  push: (events: ClientEvent[]) => json(SyncPushResponse, '/sync/push', { method: 'POST', body: JSON.stringify({ events }) }),
  pull: (since: number) => json(SyncPullResponse, `/sync/pull?since=${since}`),
  snapshot: (bankId: string, version: number) => json(BankSnapshot, `/banks/${encodeURIComponent(bankId)}/snapshot?version=${version}`),
  versions: (bankId: string) => json(BankVersionsResponse, `/banks/${encodeURIComponent(bankId)}/versions`),
  rollback: (bankId: string, toVersion: number) =>
    json(PublishResponse, `/banks/${encodeURIComponent(bankId)}/rollback`, { method: 'POST', body: JSON.stringify({ to_version: toVersion }) }),
  exportFile: async () => (await request('/export')).blob(),
  media: (sha256: string) => request(`/media/${sha256}`, { headers: { Accept: 'image/*' } }),
};

export const mediaPath = (sha256: string) => `${ROUTES.api}/media/${sha256}`;
