import { MeResponse, ROUTES } from '@de-trainer/core';

export type MeResult =
  | { kind: 'signed-in'; me: MeResponse }
  | { kind: 'signed-out' }
  | { kind: 'forbidden' }
  | { kind: 'offline' }
  | { kind: 'error'; message: string };

export async function fetchMe(): Promise<MeResult> {
  let res: Response;
  try {
    // An expired Access session answers with a redirect to the Access login page.
    // Keep it as a signal instead of following it cross-origin.
    res = await fetch(`${ROUTES.api}/me`, {
      redirect: 'manual',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
  } catch {
    return { kind: 'offline' };
  }
  if (res.type === 'opaqueredirect' || res.status === 401) return { kind: 'signed-out' };
  if (res.status === 403) return { kind: 'forbidden' };
  if (!res.ok) return { kind: 'error', message: `HTTP ${res.status}` };
  const parsed = MeResponse.safeParse(await res.json());
  return parsed.success ? { kind: 'signed-in', me: parsed.data } : { kind: 'error', message: 'Неожиданный ответ сервера' };
}
