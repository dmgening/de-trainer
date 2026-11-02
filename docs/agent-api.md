# API для Номира

Базовый адрес — `https://de-class.vta.dev/agent/v1`. Каждый запрос несёт заголовки сервисного токена Cloudflare Access:

```
CF-Access-Client-Id: <id>
CF-Access-Client-Secret: <secret>
```

Права выдаются на конкретного пользователя или банк; что выдано, показывает `GET /whoami`. Пользователи видны только по непрозрачному `user_id`, без имени и email. Журнал можно читать и дополнять своими событиями, но нельзя менять или удалять.

JSON Schema всех тел — `GET /schema` (список) и `GET /schema/{name}`: `package`, `recommendations`, `scheduler-config`, `agent-events`, `client-events`, `snapshot`. Это те же схемы, которыми сервер проверяет запросы.

## Ошибки

```json
{ "error": { "code": "invalid_package", "message": "Package rejected: 2 problem(s)",
  "issues": [{ "path": "exercises[3].primary_skill_id", "message": "Unknown or retired skill s-dativ" }] } }
```

| Статус | Когда |
|---|---|
| 400 | Тело не JSON или не по схеме запроса |
| 401 / 403 | Нет токена / нет права на этого пользователя или банк |
| 404 | Нет такого маршрута, пользователя, версии |
| 409 | Тот же `package_id` и `package_version` уже опубликован с другим содержимым |
| 413 / 415 | Слишком большой файл / не JPEG, PNG или WebP |
| 422 | Содержимое не проходит проверку: смотрите `issues` |

## Чтение

| Метод и путь | Право | Что возвращает |
|---|---|---|
| `GET /whoami` | — | Агент и его права |
| `GET /users` | — | Пользователи, на которых есть права: `user_id`, банки, права |
| `GET /users/{user_id}/events?since=&types=&limit=` | `events:read` | Журнал по `seq` с сырыми ответами; `has_more` и `max_seq` для следующей страницы |
| `GET /users/{user_id}/state` | `events:read` | Состояние по навыкам и элементам знания для каждого банка, тем же алгоритмом, что на устройстве |
| `GET /banks/{bank_id}` | `bank:publish` | Текущая версия банка со всеми объектами, включая черновики, и история версий |

Типы событий: `session_started`, `attempt`, `session_finished`, `exercise_flagged` пишет устройство; `diagnosis`, `flag_resolved`, `attempts_invalidated` — Номир. В `attempt` есть `response` (сырой ответ: `option_id`, значения пропусков или последовательность плиток), `result` (`correct`, `near_miss`, `wrong`, `skipped`, `revealed`), `parts` по пропускам, `hints_used`, `retry` (повтор после ошибки в той же сессии), `mode` (`recommended` или `practice`) и копия тегов ревизии.

## Публикация контента

1. **Картинки.** `PUT /banks/{bank_id}/media/{sha256}`, тело — байты файла. Только JPEG, PNG и WebP, до 512 КБ и 2048 px по стороне; `sha256` в пути должен совпасть с содержимым. Повторная загрузка безвредна. Ориентир — до ~150 КБ WebP на картинку: весь банк живёт на телефоне.
2. **Проверка.** `POST /banks/{bank_id}/packages/validate` с пакетом. Ответ — `status: "valid"`, будущий номер версии и `diff` (`added`, `changed`, `retired`) без записи; либо 422 с `issues`.
3. **Публикация.** `POST /banks/{bank_id}/packages` с тем же пакетом. Применяется целиком или не применяется. Ответ `201` — `status: "published"`, `version`, `diff`. Повтор того же пакета — `200 unchanged` с той же версией.
4. **Откат.** `POST /banks/{bank_id}/rollback` `{"to_version": N}` — новая версия с содержимым версии N. Ничего не удаляется.

### Пакет

Пакет — изменение банка, а не полный снимок: объекты, которых нет в пакете, остаются как были. Снимать нужно явно через `retire`.

```json
{
  "schema_version": 1,
  "bank_id": "main",
  "package_id": "lesson-2026-11-04",
  "package_version": 1,
  "created_at": "2026-11-04T18:00:00Z",
  "audience": "owner",
  "changelog": "Занятие 4 ноября: Wohnung, wo/wohin",
  "topics": [{ "topic_id": "wohnung", "revision": 1, "title": "Wohnung", "lesson_order": 12, "lesson_date": "04.11" }],
  "skills": [{ "skill_id": "wo-dativ", "revision": 1, "title": "Wo? — Dativ", "topic_ids": ["wohnung"] }],
  "knowledge_items": [{ "item_id": "unter-dem", "revision": 1, "label": "unter dem", "kind": "construction", "skill_ids": ["wo-dativ"] }],
  "media": [{ "media_id": "room-1", "sha256": "…" }],
  "exercises": [{
    "exercise_id": "wo-katze-1", "revision": 1, "family_id": "room-wo", "status": "published",
    "topic_ids": ["wohnung"], "primary_skill_id": "wo-dativ", "knowledge_item_ids": ["unter-dem"],
    "prompt": "Wo ist die Katze?",
    "stimulus": { "media": { "media_id": "room-1", "alt": "Кошка лежит под столом" } },
    "answer_spec": { "type": "choice", "options": [{ "id": "a", "text": "unter dem Tisch" }, { "id": "b", "text": "unter den Tisch" }], "correct": ["a"] },
    "explanation": "wo? → Dativ: unter dem Tisch.",
    "hints": ["Вопрос wo? требует Dativ."]
  }],
  "retire": [{ "kind": "exercise", "id": "old-exercise" }]
}
```

Правила, которые проверяет сервер:

- ID не переиспользуются. Изменение содержимого — та же ID и `revision` больше прежней; та же ревизия с другим содержимым — ошибка.
- Все ссылки (темы, навыки, элементы, картинки) должны разрешаться в итоговом банке. Нельзя снять навык, на который ссылается опубликованное задание.
- `media_id` навсегда привязан к одному файлу: новая картинка — новый `media_id`.
- В тренировку попадают только `status: "published"`; `draft` и `reviewed` хранятся, но не выдаются.
- Текст — только текст: HTML-теги и HTML-сущности отклоняются, лишние поля тоже.
- `lesson_order` задаёт давность занятия (больше — новее): дате без года сервер не доверяет.
- `"key_fix": true` в новой ревизии упражнения значит «в прежнем ключе была ошибка»: попытки на прежних ревизиях перестают влиять на оценку (сервер сам пишет `attempts_invalidated`).

### Форматы ответа

| `answer_spec.type` | Поля | Как проверяется |
|---|---|---|
| `choice` | `options[{id,text}]` (2–6), `correct[]`, `shuffle` | Выбран один из `correct` |
| `gaps` | `template` с `{id}`, `gaps[]` | Каждый пропуск отдельно; итог — худший из пропусков |
| `order` | `unit: word\|line`, `tiles[{id,text}]`, `accept[[id…]]` | Последовательность совпадает с одной из `accept` (по тексту плиток) |

Пропуск: `mode: "input"` — `accept[]`, `case` (`insensitive` по умолчанию), `punctuation` (`ignore` по умолчанию), `umlaut_fallback` (принимать ae/oe/ue/ss, по умолчанию нет), `near_miss: "typo1"` (одна опечатка = «почти», кроме умлаутов, последних двух букв и слов короче 5 букв); `mode: "chips"` — `options[]` и `correct[]`. У каждого пропуска свои `knowledge_item_ids`: результат пропуска относится к ним.

Для `order` слова в начале предложения пишутся строчными (`ich`, `heute`): приложение само ставит заглавную в начале. Несколько правильных порядков перечисляются в `accept`.

Стимул: `text`, `passage` (`kind: text|dialogue`, строки со `speaker`), `media` (`media_id` и обязательный `alt`).

## Адаптация

**Приоритеты.** `PUT /users/{user_id}/recommendations` (право `recommendations:write`) заменяет весь набор:

```json
{ "generated_at": "2026-11-04T20:00:00Z",
  "recommendations": [{ "recommendation_id": "r-mit", "scope": { "type": "skill", "id": "mit-dativ" },
    "weight": 0.9, "reason": "Путаешь Dativ и Akkusativ после mit", "expires_at": "2026-11-18T00:00:00Z" }] }
```

`scope.type`: `skill`, `knowledge_item`, `topic`, `exercise`, `family`. Приоритеты заполняют долю «слабые места» тренировки, `reason` показывается Диме на главной. После `expires_at` приложение возвращается к своему правилу: навыки с ошибками в последних попытках. Пустой список снимает приоритеты.

**Параметры планировщика.** `PUT /users/{user_id}/scheduler-config` (право `scheduler:write`), границы — в `GET /schema/scheduler-config`:

| Поле | По умолчанию | Границы |
|---|---|---|
| `ladder_days` | 1, 3, 7, 14, 30 | 3–10 ступеней, 1–365 дней, строго растут |
| `weights` (`weak`, `recent`, `due`, `variety`) | 0.4, 0.3, 0.2, 0.1 | каждая 0–0.7, сумма ≥ 0.5 |
| `default_session_size` | 10 | 5–30 |
| `recent_lessons` | 2 | 1–5 |
| `max_per_family` | 2 | 1–5 |
| `max_topic_share` | 0.6 | 0.3–1 |
| `new_per_session` | 5 | 0–20 |
| `stable` (`min_step`, `min_days`, `min_exercises`) | 3, 2, 2 | 2–10, 1–10, 1–10 |

**События.** `POST /users/{user_id}/events` (право `events:write`), до 500 за раз; `event_id` (UUID) можно задать для идемпотентности:

```json
{ "events": [
  { "type": "diagnosis", "payload": { "attempt_ids": ["…"], "skill_ids": ["mit-dativ"], "note": "После mit ставит Akkusativ" } },
  { "type": "flag_resolved", "payload": { "bank_id": "main", "exercise_id": "wo-kueche", "decision": "fixed", "revision": 2, "note": "Исправлен ключ" } },
  { "type": "attempts_invalidated", "payload": { "bank_id": "main", "exercise_id": "wo-kueche", "revisions_below": 2, "reason": "Неверный ключ" } }
] }
```

Отметки «спорное» (`exercise_flagged`) скрывают задание у Димы до `flag_resolved` по этому `exercise_id`. Решение `fixed` — после публикации исправленной ревизии (с `key_fix`, если менялся ключ); `retired` — после снятия через `retire`; `rejected` — задание верное, вернуть как есть.

## Как приложение использует данные

- Интервалы ведутся по навыкам и элементам знания: лестница `ladder_days`. Ступень растёт только от ответа без подсказок в рекомендованной тренировке, когда срок наступил, и не больше раза за сессию. Ошибка или показ ответа снижает ступень на одну и ставит повтор на завтра. Свободная практика и повтор после ошибки в той же сессии интервалов не двигают.
- Статусы: `no_data`, `learning`, `needs_practice` (ошибка в одном из двух последних ответов), `consolidating` (ступень ≥ 2), `stable` (ступень ≥ `stable.min_step`, успехи в `min_days` разных днях на `min_exercises` разных заданиях).
- Тренировка собирается из четырёх долей по `weights`: слабые места (приоритеты Номира или свежие ошибки), недавние занятия (`recent_lessons` последних по `lesson_order`), повторение по сроку, разнообразие. Одно задание не повторяется, у одного семейства — не больше `max_per_family`, у одной темы — не больше `max_topic_share`.
