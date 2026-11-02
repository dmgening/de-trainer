import { defineConfig } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { BASE_URL, DATA_DIR, PORT } from './env';

// Runs against the production build (`pnpm build` first): the real server with SQLite,
// dev sign-in instead of Cloudflare Access, the owner PWA with its service worker, and the demo.
export default defineConfig({
  testDir: './tests',
  // One server and one database: scenarios run one after another.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    viewport: { width: 360, height: 780 },
    locale: 'ru-RU',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'pnpm exec tsx seed.ts && node ../apps/server/dist/main.js',
    cwd: fileURLToPath(new URL('.', import.meta.url)),
    url: `${BASE_URL}/healthz`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: { APP_ENV: 'dev', HOST: '127.0.0.1', PORT: String(PORT), DATA_DIR, LOG_LEVEL: 'warn' },
  },
});
