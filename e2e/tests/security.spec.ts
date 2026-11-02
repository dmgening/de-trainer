import { expect, test } from '@playwright/test';
import { ContentPackage } from '@de-trainer/core';
import { ownerPackage } from '@de-trainer/fixtures';
import { USERS } from '../env';
import { agent, login } from '../helpers';

test('A09: personal and agent APIs refuse requests without the right token', async ({ request, page }) => {
  expect((await request.get('/api/me')).status()).toBe(401);
  expect((await request.get('/api/sync/pull')).status()).toBe(401);
  expect((await request.get('/agent/v1/whoami')).status()).toBe(401);

  // A signed-in learner's cookie does not open the agent API.
  await login(page, USERS.training);
  expect((await page.request.get('/agent/v1/whoami')).status()).toBe(401);

  // Nomir cannot write learner events or change the log.
  const users = await (await agent(request).get('/users')).json();
  const userId = users.users[0].user_id as string;
  const attempt = await agent(request).post(`/users/${userId}/events`, { events: [{ type: 'attempt', payload: {} }] });
  expect(attempt.status()).toBe(400);
  expect((await agent(request).delete(`/users/${userId}/events`)).status()).toBe(404);
  expect((await agent(request).put(`/users/${userId}/events`, { events: [] })).status()).toBe(404);
});

test('A15: markup in a package is refused with a readable error and the page CSP forbids inline code', async ({ request, page }) => {
  const pkg = ContentPackage.parse(ownerPackage('dev'));
  const evil = { ...pkg, package_id: 'evil', exercises: [{ ...pkg.exercises[0]!, revision: 9, prompt: '<img src=x onerror=alert(1)>' }] };
  const res = await agent(request).post('/banks/dev/packages', evil);
  expect(res.status()).toBe(422);
  const body = await res.json();
  expect(body.error.issues).toContainEqual({ path: 'exercises.0.prompt', message: 'HTML markup and entities are not allowed' });
  expect(JSON.stringify(body)).not.toMatch(/\bat \S+\.(ts|js)|stack/);

  const shell = await page.goto('/');
  const csp = shell!.headers()['content-security-policy'] ?? '';
  expect(csp).toContain("script-src 'self'");
  expect(csp).toContain("object-src 'none'");
  expect(csp).not.toContain('unsafe-inline');
});
