import { expect, test, type Page } from '@playwright/test';
import { USERS } from '../env';
import { agent, localEvents, login, me, runSession, snapshot, startButton, startSession } from '../helpers';

const syncLine = (page: Page) => page.locator('.sync-line');

/** The shell must come from the service worker before the network goes away. */
async function waitForOfflineReady(page: Page) {
  await expect(syncLine(page)).toContainText('синхронизировано');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(startButton(page)).toBeVisible();
}

test('A11: after the first load, sessions run offline across restarts and sync once back online', async ({ page, context, request }) => {
  await login(page, USERS.offline);
  const bank = await snapshot(page, 'dev');
  const { user_id } = await me(page);
  await waitForOfflineReady(page);

  await context.setOffline(true);
  await page.reload();
  await expect(syncLine(page)).toContainText('нет связи');
  await startSession(page, 5);
  await runSession(page, bank, (n) => (n === 1 ? 'wrong' : 'correct'));

  // Close the app and open it again, still offline.
  const again = await context.newPage();
  await page.close();
  await again.goto('/');
  await expect(startButton(again)).toBeVisible();
  await startSession(again, 5);
  await runSession(again, bank);
  const offline = await localEvents(again);
  expect(offline.filter((e) => e.synced === 0).length).toBeGreaterThan(10);

  await context.setOffline(false);
  await expect(syncLine(again)).not.toContainText('неотправленных', { timeout: 20_000 });
  await expect(syncLine(again)).not.toContainText('нет связи');

  const server = await agent(request).events(user_id);
  const ids = server.map((e) => e.event_id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.sort()).toEqual(offline.map((e) => e.event_id).sort());
  expect((await localEvents(again)).every((e) => e.synced === 1)).toBe(true);

  await again.getByRole('navigation').getByRole('link', { name: 'История' }).click();
  await expect(again.locator('.session-link')).toHaveCount(2);
});

test('A12: two devices of one learner merge their sessions without losses', async ({ browser, request }) => {
  const phone = await (await browser.newContext()).newPage();
  const laptop = await (await browser.newContext()).newPage();
  await login(phone, USERS.devices);
  await login(laptop, USERS.devices);
  const bank = await snapshot(phone, 'dev');
  const { user_id } = await me(phone);
  await waitForOfflineReady(phone);

  // The phone trains on a plane while the laptop trains online.
  await phone.context().setOffline(true);
  await startSession(phone, 5);
  await runSession(phone, bank);
  await startSession(laptop, 5);
  await runSession(laptop, bank);
  await phone.context().setOffline(false);
  for (const page of [phone, laptop]) await expect(syncLine(page)).not.toContainText('неотправленных', { timeout: 20_000 });

  // Each device picks up the other's sessions on its next sync.
  for (const page of [phone, laptop]) {
    await page.goto('/#/history');
    await page.reload();
    await expect(page.locator('.session-link')).toHaveCount(2, { timeout: 15_000 });
  }
  const server = await agent(request).events(user_id);
  expect(server.filter((e) => e.type === 'session_finished')).toHaveLength(2);
  expect(new Set(server.map((e) => e.device_id)).size).toBe(2);
});
