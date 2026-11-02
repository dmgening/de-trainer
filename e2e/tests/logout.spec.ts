import { expect, test } from '@playwright/test';
import { USERS } from '../env';
import { login, runSession, snapshot, startSession } from '../helpers';

test('A10: logout wipes personal data before the demo, including back navigation', async ({ page }) => {
  await login(page, USERS.logout);
  const bank = await snapshot(page, 'dev');
  await startSession(page, 5);
  await runSession(page, bank);
  await expect(page.locator('.sync-line')).not.toContainText('неотправленных', { timeout: 15_000 });

  page.on('dialog', (d) => void d.accept());
  await page.getByRole('navigation').getByRole('link', { name: 'Данные' }).click();
  await page.getByRole('button', { name: 'Выйти и удалить данные с устройства' }).click();
  await page.waitForURL('**/demo/');
  await expect(page.getByText('Демо. Прогресс хранится только в этом браузере')).toBeVisible();

  const storage = await page.evaluate(async () => ({
    dbs: (await indexedDB.databases()).map((d) => d.name),
    caches: await caches.keys(),
    keys: Object.keys(localStorage),
  }));
  expect(storage.dbs.filter((n) => n?.startsWith('de-class:owner'))).toEqual([]);
  expect(storage.caches.filter((n) => n.startsWith('owner-media'))).toEqual([]);
  expect(storage.keys.filter((k) => k.startsWith('de-class:owner'))).toEqual([]);

  const personal = /E2E logout|Тренировка не закончена|сами —/;
  await page.goBack();
  await expect(page.locator('body')).not.toContainText(personal);
  await page.goto('/#/history');
  await expect(page.getByRole('link', { name: 'Войти через Google' })).toBeVisible();
  await expect(page.locator('body')).not.toContainText(personal);
});
