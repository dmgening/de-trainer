import { expect, test } from '@playwright/test';
import { ContentPackage, snapshotFromPackage } from '@de-trainer/core';
import { FIXTURE_MEDIA, demoPackage } from '@de-trainer/fixtures';
import { runSession } from '../helpers';

const media = new Map(Object.values(FIXTURE_MEDIA).map(({ sha256, mime, bytes, width, height }) => [sha256, { mime, bytes, width, height }]));
const bank = snapshotFromPackage(ContentPackage.parse(demoPackage), media);

test('A08: a guest trains in the demo without signing in, never touches the personal API, and can reset', async ({ page }) => {
  const personal: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith('/api') || path.startsWith('/auth') || path.startsWith('/agent')) personal.push(path);
  });
  await page.goto('/demo/');
  await expect(page.getByText('Демо. Прогресс хранится только в этом браузере и может быть потерян при очистке данных.')).toBeVisible();

  // Every demo exercise once: all P0 formats, image and dialogue included (A02).
  await page.getByRole('radio', { name: '20', exact: true }).click();
  await page.getByRole('button', { name: /^Начать/ }).click();
  const seen = new Set<string>();
  const outcomes = await runSession(page, bank, (n) => (n % 4 === 3 ? 'wrong' : 'correct'));
  for (const o of outcomes) seen.add(o.exercise);
  expect(seen.size).toBe(bank.exercises.length);
  expect(outcomes.filter((o) => o.feedback === 'Ошибка.').length).toBeGreaterThan(0);

  await page.getByRole('link', { name: 'Разбор ответов' }).click();
  await expect(page.locator('.attempt')).toHaveCount(outcomes.length);
  expect(personal).toEqual([]);

  page.on('dialog', (d) => void d.accept());
  await page.getByRole('navigation').getByRole('link', { name: 'Данные' }).click();
  await page.getByRole('button', { name: 'Сбросить прогресс' }).click();
  await expect(page.getByRole('button', { name: /^Начать/ })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'История' }).click();
  await expect(page.getByText('Тренировок пока не было.')).toBeVisible();
  expect(personal).toEqual([]);
});

test('demo images come from the demo build and render', async ({ page }) => {
  await page.goto('/demo/');
  await page.getByRole('navigation').getByRole('link', { name: 'Темы' }).click();
  await page.locator('.topic').filter({ has: page.getByRole('heading', { name: 'Wohnung' }) }).getByRole('button', { name: 'Практика', exact: true }).click();
  for (let i = 0; i < 10; i++) {
    const img = page.locator('.stimulus-media img');
    if (await img.count()) {
      await expect(img).toHaveAttribute('src', /^\/demo\/media\/[a-f0-9]{64}\.png$/);
      await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(480);
      await expect(img).toHaveAttribute('alt', /кошка/);
      return;
    }
    await page.getByRole('button', { name: 'Пропустить' }).click();
    await page.getByRole('button', { name: 'Дальше' }).click();
  }
  throw new Error('No image exercise in the Wohnung practice');
});
