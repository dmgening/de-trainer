# de-class

Мобильный тренажёр немецкого по материалам реальных занятий. PWA с полным офлайном; контент и анализ ошибок готовит агент Номир через API.

- Архитектура: [docs/tech-spec.md](docs/tech-spec.md)
- Эксплуатация и деплой: [docs/ops.md](docs/ops.md)
- API для Номира: [docs/agent-api.md](docs/agent-api.md)
- Инструкция для Димы: [docs/guide.md](docs/guide.md)
- Отчёт приёмки: [docs/acceptance.md](docs/acceptance.md)

## Структура

```
apps/web          PWA (React, Vite): сборки owner (/) и demo (/demo/)
apps/server       Node + Hono: /api, /auth, /agent/v1, статика, SQLite
packages/core     схемы, проверка ответа, вывод состояния, сборка тренировки, публикация
packages/fixtures демо-пакет, тестовый пакет владельца и их картинки
deploy            systemd, cloudflared, Litestream, env
scripts/deploy.sh деплой релиза в контейнере
```

## Разработка

Нужны Node 22 и pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev
```

`pnpm dev` поднимает сервер на `127.0.0.1:8080` с локальной заменой Cloudflare Access и Vite на `localhost:5173`. Кнопка «Войти через Google» в dev сразу входит как `dev@local.test`; его банк `dev` заполнен тестовым пакетом из `packages/fixtures`. Демо: `pnpm --filter @de-trainer/web dev:demo`.

Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.

Собранное приложение так, как его отдаёт прод: `pnpm build`, затем `node apps/server/dist/main.js` (`APP_ENV` по умолчанию `dev`) — owner на `http://127.0.0.1:8080/`, демо на `/demo/`.

API Номира локально:

```bash
TOKEN=$(pnpm -s admin dev:token --client-id dev-agent.access)
curl -H "Cf-Access-Jwt-Assertion: $TOKEN" http://127.0.0.1:8080/agent/v1/whoami
```

Админ-команды: `pnpm admin` без аргументов печатает список.
