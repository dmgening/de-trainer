import { expect, test } from '@playwright/test';
import { USERS } from '../env';
import { agent, localEvents, login, me, runSession, snapshot, startButton, startSession } from '../helpers';

const RETRY = 'ещё раз после ошибки';

test('A01: ten questions with feedback, summary and history, stored on the server', async ({ page, request }) => {
  await login(page, USERS.training);
  const bank = await snapshot(page, 'dev');
  await startSession(page, 10);
  const outcomes = await runSession(page, bank, (n) => (n === 0 ? 'wrong' : 'correct'));

  const first = bank.exercises.find((e) => e.exercise_id === outcomes[0]!.exercise)!;
  expect(outcomes[0]).toMatchObject({ feedback: 'Ошибка.', explanation: first.explanation });
  expect(outcomes.slice(1).every((o) => o.feedback === 'Верно!')).toBe(true);
  // The mistake brings the skill back later in the same session.
  expect(outcomes.some((o) => o.reason === RETRY)).toBe(true);

  const independent = outcomes.filter((o) => o.feedback === 'Верно!' && o.reason !== RETRY).length;
  await expect(page.locator('.stats div').filter({ hasText: 'Сами, без подсказок' }).locator('dd')).toHaveText(String(independent));
  await expect(page.locator('.stats div').filter({ hasText: 'Ошибки' }).locator('dd')).toHaveText('1');

  await page.getByRole('link', { name: 'Разбор ответов' }).click();
  await expect(page.locator('.attempt')).toHaveCount(outcomes.length);
  await page.getByRole('navigation').getByRole('link', { name: 'История' }).click();
  await expect(page.locator('.session-link')).toHaveCount(1);

  const { user_id } = await me(page);
  await expect
    .poll(async () => (await agent(request).events(user_id)).filter((e) => e.type === 'attempt').length, { timeout: 15_000 })
    .toBe(outcomes.length);
});

test("A16: Nomir's priority shows on the home screen and leads the next session", async ({ page, request }) => {
  await login(page, USERS.priorities);
  const bank = await snapshot(page, 'dev');
  const { user_id } = await me(page);
  const reason = 'Путаешь Dativ и Akkusativ после mit';
  const res = await agent(request).put(`/users/${user_id}/recommendations`, {
    generated_at: new Date().toISOString(),
    recommendations: [{ recommendation_id: 'r-mit', scope: { type: 'skill', id: 'mit-dativ' }, weight: 1, reason, expires_at: '2099-01-01T00:00:00Z' }],
  });
  expect(res.status()).toBe(200);

  await page.reload();
  await expect(page.locator('.reasons')).toContainText(reason);
  await startSession(page, 5);
  const outcomes = await runSession(page, bank);
  const prioritised = outcomes.filter((o) => o.reason === reason).map((o) => o.exercise);
  expect(prioritised.sort()).toEqual(['mit-bus', 'mit-zug']);
});

test('A17: a disputed exercise is hidden until Nomir resolves it', async ({ page, request }) => {
  await login(page, USERS.flags);
  const bank = await snapshot(page, 'dev');
  const { user_id } = await me(page);
  const practiceWohnung = async () => {
    await page.getByRole('navigation').getByRole('link', { name: 'Темы' }).click();
    await page.locator('.topic').filter({ has: page.getByRole('heading', { name: 'Wohnung' }) }).getByRole('button', { name: 'Практика', exact: true }).click();
    await expect(page.locator('article.question')).toBeVisible();
  };

  await practiceWohnung();
  const flagged = (await page.locator('article.question').getAttribute('data-exercise-id'))!;
  await page.getByRole('button', { name: 'Спорное задание?' }).click();
  await page.getByLabel('Что не так с заданием?').fill('Кажется, ключ неверный');
  await page.getByRole('button', { name: 'Отметить спорным' }).click();
  await expect(page.locator('article.question')).not.toHaveAttribute('data-exercise-id', flagged);
  const rest = await runSession(page, bank);
  expect(rest.map((o) => o.exercise)).not.toContain(flagged);

  await expect
    .poll(async () => (await agent(request).events(user_id)).filter((e) => e.type === 'exercise_flagged').map((e) => (e.payload as { exercise_id: string }).exercise_id))
    .toEqual([flagged]);
  await page.goto('/#/');
  await practiceWohnung();
  expect((await runSession(page, bank)).map((o) => o.exercise)).not.toContain(flagged);

  const resolved = await agent(request).post(`/users/${user_id}/events`, {
    events: [{ type: 'flag_resolved', payload: { bank_id: 'dev', exercise_id: flagged, decision: 'rejected', note: 'Ключ верный' } }],
  });
  expect(resolved.status()).toBe(200);
  await page.goto('/#/');
  await page.reload();
  await expect(startButton(page)).toBeVisible();
  await expect.poll(async () => (await localEvents(page)).some((e) => e.type === 'flag_resolved')).toBe(true);
  await practiceWohnung();
  expect((await runSession(page, bank)).map((o) => o.exercise)).toContain(flagged);
});
