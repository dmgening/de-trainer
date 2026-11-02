import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type APIRequestContext, type Page } from '@playwright/test';
import type { BankSnapshot, StoredEvent } from '@de-trainer/core';
import { DATA_DIR } from './env';

export type How = 'correct' | 'wrong' | 'skip';

export const startButton = (page: Page) => page.getByRole('button', { name: /^Начать/ });

export async function login(page: Page, email: string) {
  await page.goto(`/auth/dev-login?email=${encodeURIComponent(email)}`);
  await expect(startButton(page)).toBeVisible();
}

export async function me(page: Page): Promise<{ user_id: string }> {
  return (await page.request.get('/api/me')).json();
}

export async function snapshot(page: Page, bankId: string): Promise<BankSnapshot> {
  const res = await page.request.get(`/api/banks/${bankId}/snapshot`);
  expect(res.status()).toBe(200);
  return res.json();
}

export async function startSession(page: Page, size: number) {
  await page.getByRole('radio', { name: String(size), exact: true }).click();
  await startButton(page).click();
  await expect(page.locator('article.question')).toBeVisible();
}

/** Answers the question on screen the way a learner would: taps, typing, tiles. Returns the feedback title. */
export async function answer(page: Page, bank: BankSnapshot, how: How): Promise<string> {
  const q = page.locator('article.question');
  const id = await q.getAttribute('data-exercise-id');
  const ex = bank.exercises.find((e) => e.exercise_id === id);
  if (!ex) throw new Error(`Exercise ${id} is not in the bank snapshot`);
  const spec = ex.answer_spec;
  if (how === 'skip') {
    await q.getByRole('button', { name: 'Пропустить' }).click();
  } else if (spec.type === 'choice') {
    const option = how === 'correct' ? spec.correct[0]! : spec.options.find((o) => !spec.correct.includes(o.id))!.id;
    await q.locator(`[data-option-id="${option}"]`).click();
  } else if (spec.type === 'gaps') {
    for (const g of spec.gaps) {
      if (g.mode === 'input') {
        await q.locator(`input[data-gap-id="${g.id}"]`).fill(how === 'correct' ? g.accept[0]! : 'xyzzy');
      } else {
        const option = how === 'correct' ? g.correct[0]! : g.options.find((o) => !g.correct.includes(o.id))!.id;
        await q.locator(`[data-gap-id="${g.id}"] [data-option-id="${option}"]`).click();
      }
    }
    await q.getByRole('button', { name: 'Проверить' }).click();
  } else {
    const order = how === 'correct' ? spec.accept[0]! : [...spec.accept[0]!].reverse();
    for (const tile of order) await q.locator(`.order-pool [data-tile-id="${tile}"]`).click();
    await q.getByRole('button', { name: 'Проверить' }).click();
  }
  const title = q.locator('.feedback-title');
  await expect(title).toBeVisible();
  return (await title.textContent()) ?? '';
}

/** Answers until the summary screen; `plan` picks how to answer the n-th question. */
export async function runSession(page: Page, bank: BankSnapshot, plan: (n: number) => How = () => 'correct') {
  const outcomes: { exercise: string; prompt: string; reason: string; feedback: string; explanation: string }[] = [];
  for (let n = 0; n < 40; n++) {
    const q = page.locator('article.question');
    const exercise = (await q.getAttribute('data-exercise-id')) ?? '';
    const prompt = (await q.locator('.prompt').textContent()) ?? '';
    const reason = (await q.locator('.reason').textContent()) ?? '';
    const feedback = await answer(page, bank, plan(n));
    const explanation = (await q.locator('.explanation').textContent()) ?? '';
    outcomes.push({ exercise, prompt, reason, feedback, explanation });
    await q.getByRole('button', { name: 'Дальше' }).click();
    // Either the summary or the next question without feedback (it may be the same exercise again).
    await expect
      .poll(async () => page.url().includes('#/summary/') || ((await q.count()) === 1 && (await q.locator('.feedback').count()) === 0))
      .toBe(true);
    if (page.url().includes('#/summary/')) {
      await expect(page.locator('#summary')).toBeVisible();
      return outcomes;
    }
  }
  throw new Error('Session did not finish within 40 answers');
}

/** Events stored on the device, read straight from the owner's IndexedDB. */
export async function localEvents(page: Page): Promise<{ event_id: string; type: string; synced: number }[]> {
  return page.evaluate(async () => {
    const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n?.startsWith('de-class:owner:'));
    if (!name) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const rows = await new Promise<{ event_id: string; type: string; synced: number }[]>((resolve) => {
      const req = db.transaction('events').objectStore('events').getAll();
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return rows.map((r) => ({ event_id: r.event_id, type: r.type, synced: r.synced }));
  });
}

export async function kv<T>(page: Page, key: string): Promise<T | undefined> {
  return page.evaluate(async (k) => {
    const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n?.startsWith('de-class:owner:'));
    if (!name) return undefined;
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
    });
    const row = await new Promise<{ value: unknown } | undefined>((resolve) => {
      const req = db.transaction('kv').objectStore('kv').get(k);
      req.onsuccess = () => resolve(req.result);
    });
    db.close();
    return row?.value;
  }, key) as Promise<T | undefined>;
}

/** Nomir's side, through the real agent API with a dev-signed service token. */
export function agent(request: APIRequestContext) {
  const headers = { 'Cf-Access-Jwt-Assertion': readFileSync(path.join(DATA_DIR, 'agent-token'), 'utf8') };
  return {
    get: (url: string) => request.get(`/agent/v1${url}`, { headers }),
    post: (url: string, data: unknown) => request.post(`/agent/v1${url}`, { headers, data }),
    put: (url: string, data: unknown) => request.put(`/agent/v1${url}`, { headers, data }),
    delete: (url: string) => request.delete(`/agent/v1${url}`, { headers }),
    async events(userId: string): Promise<StoredEvent[]> {
      const res = await request.get(`/agent/v1/users/${userId}/events?limit=5000`, { headers });
      expect(res.status()).toBe(200);
      return (await res.json()).events;
    },
  };
}
