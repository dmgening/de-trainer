# Эксплуатация de-class

Сервер — NixOS-контейнер в хоумлабе, наружу через Cloudflare Tunnel и Caddy, вход через Cloudflare Access. Адрес — `de-class.vta.dev`. Архитектура — [tech-spec.md](tech-spec.md).

Хост, Access-приложения, сервисный токен Номира, маршрут туннеля и бэкапы описаны кодом в репозитории хоумлаба `dmgening/homelab`: ранбук `docs/runbooks/de-class.md`, Cloudflare — `tofu/cloudflare/de-class.tf`, хост — `nix/hosts/de-class.nix`. Здесь — то, что относится к самому приложению.

Второй способ запуска — образ под Podman за Traefik на apps-хосте хоумлаба, см. [раздел 6](#6-контейнер-podman-и-traefik). Cloudflare, пользователи и проверка после деплоя (разделы 2-4) от способа не зависят.

## 1. Сборка и модуль

Этот репозиторий — flake:

- `packages.<system>.default` ([nix/package.nix](../nix/package.nix)) — серверный бандл, обе веб-сборки и runtime-зависимости сервера; `better-sqlite3` собирается из исходников. Команды: `de-trainer-server`, `de-trainer-migrate`, `de-trainer-admin`.
- `nixosModules.default` ([nix/module.nix](../nix/module.nix)) — `services.de-trainer`: системный пользователь `de-trainer`, данные в `/var/lib/de-trainer`, миграции перед каждым запуском (`ExecStartPre`), обёртка `de-trainer-admin` для root.

Хоумлаб подключает flake входом `de-trainer` и задаёт адрес, team domain и AUD-теги:

```nix
services.de-trainer = {
  enable = true;
  host = "0.0.0.0";
  access = {
    teamDomain = "https://vtanet.cloudflareaccess.com";
    userAudiences = [ "<AUD de-class owner>" ];
    agentAudiences = [ "<AUD de-class agent>" ];
  };
};
```

Секретов у сервера нет: AUD и team domain — публичные идентификаторы.

**После каждого изменения `pnpm-lock.yaml`** обновить `pnpmDeps.hash` в `nix/package.nix`: поставить `""`, запустить `nix build`, вписать хеш из ошибки. CI-job `nix` собирает пакет, когда меняются зависимости или `nix/`.

## 2. Cloudflare

| Приложение | Адреса | Политика |
|---|---|---|
| de-class owner | `de-class.vta.dev/api`, `de-class.vta.dev/auth` | Allow, IdP Google, email учеников; сессия 30 дней |
| de-class agent | `de-class.vta.dev/agent` | Service Auth: сервисный токен `nomir` (бессрочный) |

Остальное (оболочка, `/demo`, `/healthz`) идёт без Access. Туннель дополнительно проверяет JWT на `/api`, `/auth` и `/agent`; сервер проверяет его ещё раз. `de-class.vta.dev` нет в split DNS хоумлаба: из домашней сети, в том числе Номир с Hermes, трафик тоже идёт через Access.

Client ID и Secret токена `nomir` лежат в секрете Hermes (`hermes_env`), Client ID нужен ещё для `agent:add` ниже.

## 3. Первый запуск и пользователи

Порядок первого деплоя — в ранбуке хоумлаба. После деплоя на хосте:

```bash
de-trainer-admin bank:add --id main --title "Max/Dima B1"
de-trainer-admin user:add --email <gmail Димы> --name Дима --bank main --role owner
de-trainer-admin agent:add --name nomir --client-id <Client ID токена>
de-trainer-admin agent:grant --name nomir --user <gmail Димы> --perm events:read,events:write,recommendations:write,scheduler:write
de-trainer-admin agent:grant --name nomir --bank main --perm bank:publish
```

`--role owner` даёт право откатывать банк из приложения; остальные участники банка — `learner`. Новый ученик: email в `de_class.emails` в хоумлабе (Access) и `user:add`.

**Обновление** — новый коммит в `main` этого репо, затем в хоумлабе `nix flake update de-trainer --flake ./nix`, PR и деплой хоста `de-class`. **Откат** — деплой предыдущего коммита хоумлаба или `nixos-rebuild switch --rollback` на хосте. Миграции только добавляющие, поэтому старый код работает на новой схеме.

Другие команды (`de-trainer-admin` без аргументов печатает список). Файлы для `--file` должны быть доступны пользователю `de-trainer`, например лежать в `/tmp`:

| Команда | Зачем |
|---|---|
| `media:put --bank main --file img.webp` | Загрузить картинку вручную |
| `package:publish --bank main --file pkg.json` | Ручной импорт пакета с теми же проверками, что в API (F17) |
| `export --email <gmail> --file out.json` | Полная выгрузка ученика |
| `restore --email <gmail> --file out.json` | Залить журнал из выгрузки (идемпотентно по `event_id`) |
| `user:disable` / `agent:revoke` | Закрыть доступ без релиза |

Логи: `journalctl -u de-trainer`.

## 4. Проверка после деплоя

1. `curl https://de-class.vta.dev/healthz` → `ok`.
2. Браузер: `https://de-class.vta.dev` → «Войти через Google» → после входа видно имя и один банк.
3. Номир: `curl -H "CF-Access-Client-Id: <id>" -H "CF-Access-Client-Secret: <secret>" https://de-class.vta.dev/agent/v1/whoami` → агент `nomir` и его права. Дальше Номир работает по [agent-api.md](agent-api.md): загружает картинки, проверяет и публикует первый пакет.
4. Без токена `https://de-class.vta.dev/api/me` и `/agent/v1/whoami` не открываются.
5. `https://de-class.vta.dev/demo/` открывается без входа.

**iPhone (главный риск M0).** Safari → «Поделиться» → «На экран Домой». Открыть с иконки → «Войти через Google» → после входа приложение должно вернуться в себя и показать имя. Закрыть, открыть снова — вход сохраняется. Если вход уходит в Safari и не возвращается в приложение — записать, как именно, и не продолжать M1, пока не выберем обход.

## 5. Резервные копии

Сейчас — ежедневный снимок контейнера в Proxmox (vzdump; 7 дневных, 4 недельных, 3 месячных). В нём весь `/var/lib/de-trainer`: SQLite и картинки из `media/`. Снимок лежит дома, поэтому следующий шаг — копия вне дома: Litestream в R2 через `services.litestream` на хосте, ключи бакета в sops хоумлаба (ранбук хоумлаба, «Next: Litestream»). В nixpkgs Litestream 0.5, формат конфига отличается от 0.3.

Litestream копирует только SQLite. Картинки лежат в `/var/lib/de-trainer/media/` по хешу; до ежедневного `rclone` после потери диска Номир загружает их заново (`PUT …/media/{sha256}` идемпотентен).

## 6. Контейнер: Podman и Traefik

Образ — [Dockerfile](../Dockerfile), та же раскладка и те же команды, что у Nix-пакета: `de-trainer-server`, `de-trainer-migrate`, `de-trainer-admin`. При каждом старте контейнер сначала применяет миграции, затем запускает сервер. Процесс работает от `node` (uid 1000), данные — в `/data`. Без `ACCESS_*` контейнер в `prod` не стартует.

Workflow [image](../.github/workflows/image.yml) публикует образ из `main` в `ghcr.io/dmgening/de-trainer` с тегами `main` и `sha-<коммит>`; в PR, которые меняют Dockerfile или зависимости, он только собирается. Репозиторий приватный, поэтому пакет тоже приватный: на хосте нужен `docker login ghcr.io` с classic PAT со scope `read:packages` (fine-grained токены GHCR не принимает).

Стек — [compose.yaml](../compose.yaml): сервис `app` во внешней сети `ingress`, Traefik ведёт на него `Host(de-class.vta.dev)` с entrypoint `web` на порт 8080. Корень ФС только для чтения, писать можно в том `data` и tmpfs `/tmp`. Настройки — `.env` рядом со стеком по образцу [.env.example](../.env.example). В хоумлабе стек лежит в `compose/de-class/` как копия этих двух файлов с заполненным `.env`; деплоить закреплённый тег `sha-…`, не `main`.

Команды ниже — из каталога стека на хосте (`docker` там — это podman, `docker-compose` ходит в его сокет).

```bash
docker compose pull && docker compose up -d     # первый запуск и обновление
docker compose ps                               # healthy через ~20 с
docker compose logs -f app
docker compose exec app de-trainer-admin user:add --email <gmail> --name Дима --bank main --role owner
```

Файлы для `--file` сначала положить в контейнер: `docker cp` не пишет в tmpfs, поэтому через stdin.

```bash
docker compose exec -T app sh -c 'cat > /tmp/pkg.json' < pkg.json
docker compose exec app de-trainer-admin package:publish --bank main --file /tmp/pkg.json
docker compose exec -T app de-trainer-admin export --email <gmail> > out.json
```

**Обновление** — новый коммит в `main`, дождаться workflow `image`, вписать новый тег в `DE_CLASS_IMAGE` и выполнить `docker compose pull && docker compose up -d`. **Откат** — предыдущий тег, те же команды; миграции только добавляющие.

**Данные** — том `de-class_data` (SQLite и `media/`), путь на хосте: `docker volume inspect de-class_data --format '{{.Mountpoint}}'`. В бэкап apps-хоста он должен входить целиком, как `/var/lib/de-trainer` сейчас.

**Переезд с NixOS-хоста.** Остановить сервис, перенести каталог данных в том, отдать его uid 1000, поднять стек, затем переключить upstream `de-class.vta.dev` в Caddy на Traefik apps-хоста (хоумлаб).

```bash
# на de-class
systemctl stop de-trainer
tar -C /var/lib/de-trainer -czf /tmp/de-class.tgz .

# на apps-хосте, в каталоге стека, после копирования архива в /tmp
docker compose create
docker run --rm -v de-class_data:/data -v /tmp/de-class.tgz:/in.tgz:ro docker.io/library/alpine:3.21 \
  sh -c 'tar -C /data -xzf /in.tgz && chown -R 1000:1000 /data'
docker compose up -d
```

После переключения пройти проверку из раздела 4.
