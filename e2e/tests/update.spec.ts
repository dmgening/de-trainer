import { expect, test } from '@playwright/test';
import { ContentPackage } from '@de-trainer/core';
import { ownerPackage } from '@de-trainer/fixtures';
import { USERS } from '../env';
import { agent, answer, kv, login, runSession, snapshot, startButton, startSession } from '../helpers';

test('A05 + A14: a package published mid-session reaches the device but changes nothing until the session ends', async ({ page, request }) => {
  await login(page, USERS.update);
  const v1 = await snapshot(page, 'e2e-update');
  await startSession(page, 10);
  await answer(page, v1, 'correct');
  await page.getByRole('button', { name: 'Дальше' }).click();

  // Nomir rewords every exercise: revision 2 of all of them.
  const pkg = ContentPackage.parse(ownerPackage('e2e-update'));
  const v2 = {
    ...pkg,
    package_version: 2,
    changelog: 'E2E: новая редакция всех заданий',
    topics: [],
    skills: [],
    knowledge_items: [],
    media: [],
    exercises: pkg.exercises.map((e) => ({ ...e, revision: 2, prompt: `v2: ${e.prompt}` })),
  };
  const res = await agent(request).post('/banks/e2e-update/packages', v2);
  expect(res.status()).toBe(201);
  expect((await res.json()).version).toBe(2);

  // Reopening the app syncs; the running session keeps its question and its bank version.
  const prompt = await page.locator('.prompt').textContent();
  await page.reload();
  await expect.poll(() => kv<Record<string, number>>(page, 'downloaded')).toEqual({ 'e2e-update': 2 });
  expect(await kv<Record<string, number>>(page, 'current')).toEqual({ 'e2e-update': 1 });
  await expect(page.locator('.prompt')).toHaveText(prompt!);
  const rest = await runSession(page, v1);
  expect(rest.every((o) => !o.prompt.startsWith('v2:'))).toBe(true);

  // After the session the device switches to v2 and the home screen says what changed.
  await page.goto('/#/');
  await expect(page.locator('.whats-new')).toContainText('E2E: новая редакция всех заданий');
  expect(await kv<Record<string, number>>(page, 'current')).toEqual({ 'e2e-update': 2 });
  await startButton(page).click();
  await expect(page.locator('.prompt')).toHaveText(/^v2: /);
});
