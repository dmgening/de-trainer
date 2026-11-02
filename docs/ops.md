# Эксплуатация de-class

Сервер — LXC-контейнер в хоумлабе, наружу через Cloudflare Tunnel, вход через Cloudflare Access. Адрес — `de-class.vta.dev`. Архитектура — [tech-spec.md](tech-spec.md).

## 1. Контейнер

Debian 12 или новее, непривилегированный LXC: 1 vCPU, 1 ГБ RAM, 10 ГБ диска. Нужны Node 22 LTS, `corepack enable` (pnpm возьмёт версию из `packageManager`), git, curl.

```bash
useradd --system --home /var/lib/de-trainer --shell /usr/sbin/nologin de-trainer
mkdir -p /opt/de-trainer/releases /var/lib/de-trainer /etc/de-trainer
chown de-trainer:de-trainer /var/lib/de-trainer && chmod 700 /var/lib/de-trainer
git clone <repo-url> /opt/de-trainer/repo
install -m 600 /opt/de-trainer/repo/deploy/env.example /etc/de-trainer/env
install -m 644 /opt/de-trainer/repo/deploy/systemd/de-trainer.service /etc/systemd/system/
install -m 755 /opt/de-trainer/repo/deploy/de-trainer-admin /usr/local/bin/
systemctl daemon-reload && systemctl enable de-trainer
```

## 2. Cloudflare

**Туннель.** Public hostname `de-class.vta.dev` → `http://127.0.0.1:8080`, если коннектор `cloudflared` стоит в этом же контейнере ([пример конфига](../deploy/cloudflared/config.yml)). Если коннектор общий и живёт на другом хосте — `http://<ip-контейнера>:8080`, в env `HOST=0.0.0.0`, а firewall контейнера пускает на 8080 только хост коннектора.

**Access.** Zero Trust → Access → Applications, тип Self-hosted:

| Приложение | Адреса | Политика |
|---|---|---|
| de-class owner | `de-class.vta.dev/api`, `de-class.vta.dev/auth` | Allow, IdP Google, email Димы; длительность сессии 30 дней |
| de-class agent | `de-class.vta.dev/agent` | Service Auth: сервисный токен `nomir` |
| de-class public | `de-class.vta.dev` | Bypass, Everyone — нужно, только если существующее wildcard-приложение уже закрывает `*.vta.dev` |

Приложение с более специфичным путём побеждает, поэтому `/api`, `/auth` и `/agent` остаются закрытыми и при bypass на весь хост.

**Сервисный токен.** Access → Service credentials → Service Tokens → `nomir`. Client ID и Secret отдаются Номиру (Hermes), Client ID нужен ещё для `agent:add` ниже.

**Значения для `/etc/de-trainer/env`:** `ACCESS_TEAM_DOMAIN` — `https://<team>.cloudflareaccess.com`; `ACCESS_AUD_USER` и `ACCESS_AUD_AGENT` — Application Audience (AUD) Tag приложений `de-class owner` и `de-class agent`.

## 3. Первый деплой и пользователи

```bash
/opt/de-trainer/repo/scripts/deploy.sh origin/main
de-trainer-admin bank:add --id main --title "Max/Dima B1"
de-trainer-admin user:add --email <gmail Димы> --name Дима --bank main --role owner
de-trainer-admin agent:add --name nomir --client-id <Client ID токена>
de-trainer-admin agent:grant --name nomir --user <gmail Димы> --perm events:read,events:write,recommendations:write,scheduler:write
de-trainer-admin agent:grant --name nomir --bank main --perm bank:publish
```

`--role owner` даёт право откатывать банк из приложения; остальные участники банка — `learner`.

Дальше обновление — `deploy.sh <тег или origin/main>`, откат — `deploy.sh --rollback`. Скрипт собирает релиз в `/opt/de-trainer/releases/`, применяет миграции, переключает `current` и проверяет `/healthz`; хранит пять последних релизов.

Другие команды (`de-trainer-admin` без аргументов печатает список):

| Команда | Зачем |
|---|---|
| `media:put --bank main --file img.webp` | Загрузить картинку вручную |
| `package:publish --bank main --file pkg.json` | Ручной импорт пакета с теми же проверками, что в API (F17) |
| `export --email <gmail> --file out.json` | Полная выгрузка ученика |
| `restore --email <gmail> --file out.json` | Залить журнал из выгрузки (идемпотентно по `event_id`) |
| `user:disable` / `agent:revoke` | Закрыть доступ без релиза |

## 4. Проверка после деплоя

1. `curl https://de-class.vta.dev/healthz` → `ok`.
2. Браузер: `https://de-class.vta.dev` → «Войти через Google» → после входа видно имя и один банк.
3. Номир: `curl -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" https://de-class.vta.dev/agent/v1/whoami` → агент `nomir` и его права. Дальше Номир работает по [agent-api.md](agent-api.md): загружает картинки, проверяет и публикует первый пакет.
4. Без токена `https://de-class.vta.dev/api/me` и `/agent/v1/whoami` не открываются.
5. `https://de-class.vta.dev/demo/` открывается без входа.

**iPhone (главный риск M0).** Safari → «Поделиться» → «На экран Домой». Открыть с иконки → «Войти через Google» → после входа приложение должно вернуться в себя и показать имя. Закрыть, открыть снова — вход сохраняется. Если вход уходит в Safari и не возвращается в приложение — записать, как именно, и не продолжать M1, пока не выберем обход.

## 5. Litestream

Установить пакет Litestream, положить [`deploy/litestream.yml`](../deploy/litestream.yml) в `/etc/litestream.yml`. Ключи и бакет — в `/etc/de-trainer/litestream.env` (права 600): `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY`, `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT` (для R2 — `https://<account>.r2.cloudflarestorage.com`). Подключить env-файл через `systemctl edit litestream` (`EnvironmentFile=`), затем `systemctl enable --now litestream`.

Учебное восстановление: `litestream restore -o /tmp/restore.sqlite /var/lib/de-trainer/app.sqlite` и `sqlite3 /tmp/restore.sqlite 'select count(*) from users'`.

Litestream копирует только SQLite. Картинки лежат в `/var/lib/de-trainer/media/` по хешу; пока нет ежедневного `rclone`, после потери диска Номир загружает их заново (`PUT …/media/{sha256}` идемпотентен). Ежедневные выгрузки и `rclone` — следующим шагом.
