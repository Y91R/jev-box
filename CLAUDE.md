# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Назначение

Плагин `jev-box` для Claude Code на **Function Hooks** (TypeScript-модули, preview-рантайм). На каждый ход пользователя и на запуск сабагентов разрешённых типов он выбирает модель Claude из списка в конфиге. Решение всегда принимает **Jev** от TypeSafe; провайдер задаёт только канал: напрямую (`api.typesafe.ai/v1/systemone`) или через **OpenRouter** (`openrouter.ai/api/alpha/decisions`), формат запроса и ответа у них один. `effort` плагин не выбирает. Без переменной `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` хуки плагина ничего не делают (FR-24).

Кроме хуков, плагин поставляет скиллы `/jev-box:analyst-reviewer`, `/jev-box:system-analyst`, `/jev-box:feature-planner` и `/jev-box:review-plan` — копии глобальных скиллов с подсказками Jev: CLI `cli/verify.ts` помечает требования СТ с подозрительной формулировкой или без опоры в источнике и шаги плана без проверяемого критерия; пометки уходят в собственное ревью и в задание codex. Подсказки ничего не блокируют. План и решения — `docs/plans/README.md` (каталог в `.gitignore`).

Требования: `docs/requirements/model_choice.md`. Это источник истины по поведению, схеме конфига и обработке ошибок; при расхождении с этим файлом прав СТ.

## Устройство кода

Логика — чистые модули без `$`: `config.ts` (чтение и проверка конфига по FR-4), `candidates.ts` (отбор по окну контекста), `core/` (ядро клиента Jev, общее для обоих провайдеров и любых потребителей: типы вопросов Noul/Choice/Score и их ответов, построение запроса, разбор ответа с проверкой формы), `model-choice.ts` (вопрос о выборе модели на ядре, его версия и порог `minConfidence`), `classify.ts` (вызов с таймаутом, коды отказов, лог), `turns.ts` (решение на ход и правило о резервной модели движка), `debuglog.ts` (отладочный лог: буфер JSONL, файл переписывается целиком — у `$.fs` нет дозаписи). `register.ts` только связывает события с этими модулями.

`cli/` — вызов ядра вне хуков, без `$`, со своим `cli/tsconfig.json` (типы Bun только здесь). `run.ts` — логика с внедрёнными сетью, таймером, чтением файлов и выводом; `verify.ts` только связывает её с `fetch`, `setTimeout`, `Bun.file`. `extract.ts` разбирает требования `- **FR-N.** …` и шаги плана (`## Шаг N` или `### N.` под `## Решение`, строки в блоках кода заголовками не считаются), `passages.ts` режет источник на фрагменты и отбирает до 20 кандидатов по общим основам слов; `verifiers/requirements.ts`, `verifiers/sources.ts` и `verifiers/plan-steps.ts` держат вопросы, их версию и пороги. Конфиг и ключи — тот же `~/.config/jev-box/config.json`. Отказ слоя — строка `Слой Jev пропущен: <код>` и выход 0; на `network` и `http_403` (так прокси песочницы Claude отвечает на закрытый хост) — с подсказкой про `allowed_domains`.

`skills/` — скиллы плагина; вызывают CLI как `bun run ${CLAUDE_PLUGIN_ROOT}/cli/verify.ts` с `allowed_domains` для `api.typesafe.ai` и `openrouter.ai`, при отказе песочницы — с `dangerouslyDisableSandbox`. Копия `review-plan.sh` принимает абзац подсказок для codex файлом из переменной `JEV_HINTS_FILE` — текст не проходит через командную строку.

Валидатор плагинов (`claude plugin validate`) запрещает передавать `$` в функции из других файлов: вызов `$` должен быть записан в том же файле как `$.noun.event(...)`. Поэтому модули получают не `$`, а объект из `hostOf($)` в `register.ts`: в нём нужные вызовы `$` обёрнуты в обычные функции. Новый вызов `$` в модуле — это новое поле в `ConfigHost`/`ClassifyHost` и в `hostOf`.

## Function Hooks: что важно знать

- Включаются только флагом: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude`. Проверено на 2.1.278. API в статусе preview и может поменяться.
- Эталонные исходники: https://github.com/anthropics/claude-code/tree/main/mods (встроенные моды `agents-md`, `diff`, `telemetry`, `sec-default`).
- Типы (`mods/types/claude-code.d.ts` апстрима) объявляют модули `claude-code` и `claude-code/testing`. Локальная копия лежит в `docs/requirements/.st-sources/claude-code.d.ts`. Для сборки её нужно положить в `types/` и сверять при обновлении Claude Code. Это единственный надёжный источник по событиям и `$`.
- Структура плагина:
  - `.claude-plugin/plugin.json`;
  - `hooks/hooks.json`: `{ "description": ..., "modules": ["./register.ts"] }`;
  - `hooks/register.ts` экспортирует `register(on: On, options: PluginOptions)`. Хуки регистрируются как `on('<event>', ($, e, next) => next(e))`: это middleware, первый зарегистрированный оборачивает остальных.
- Сеть доступна **только** через `$.http.fetch`, таймаута у него нет. Поэтому npm-SDK провайдеров не использовать: TypeSafe и OpenRouter вызываются REST-запросом, таймаут делается через `$.clock`.
- Файлы читаются через `$.fs.read` по абсолютному пути. `~` не раскрывается, домашний каталог берётся из `$.env.get("HOME")`. Имя переменной в `$.env.get` должно быть строковым литералом.

### Точки перехвата

- `turn.start` (`{ text, turnId }`): текст пользователя, по нему идёт классификация. Результат хука ход не меняет.
- `turn.step`: каждый запрос к API внутри хода. **Менять можно только `model` и `effort`**; плагин меняет только `model` (движок сам не передаёт `effort` моделям без его поддержки). Если `agentId` нет, это главный цикл. `e.model` может оказаться резервной моделью движка, и её перебивать нельзя.
- `turn.complete`: приходит при любом исходе хода, здесь удаляется состояние хода.
- `agent.spawn`: можно переписать `model` сабагента. Модель из файла определения агента в событии не видна.
- `$.session.usage()` → `context.tokens`: заполнение контекста, по нему отбираются модели по `contextWindow`.
- `session.start` приходит раз на процесс и не приходит после `/clear`; конец сессии — `session.end`. Состояние «на сессию» сбрасывается там.
- Ожидания в хуках (`turn.step`, `agent.spawn`) гонятся с `next.signal`: после отмены `next` не вызывается.
- `next` в хуке вызывается ровно один раз: для `turn.step` каждый вызов — новый запрос к модели, для `agent.spawn` — новый сабагент. Упавший хук движок пропускает сам.

## Конфиг

`~/.config/jev-box/config.json`. Если его нет, плагин на `session.start` создаёт его из `config.example.json` (`$.plugin.root`) и делает `chmod 600`/`700` через `$.process.run` (FR-26); поэтому `config.example.json` — часть плагина, а не просто пример. Поля: провайдер, ключи, список моделей (`id`, `description`, `contextWindow`), `subagentTypes`, `timeoutMs` (не больше 9000: у хука лимит 10 с), `contextReserve` (какую долю окна модели может занимать текущий контекст, по умолчанию 0.5), `minConfidence`, `logLevel` (`off` | `debug`: отладочный лог сессии в `~/.config/jev-box/logs/<id сессии>.jsonl`, FR-25). Ключи лежат в этом же файле. `userConfig` в `plugin.json` и переменные окружения для настроек не используются. Конфиг перечитывается перед каждой классификацией.

## Команды

- Установка: `bun install` (в песочнице Claude Code — с `BUN_TMPDIR` и `BUN_INSTALL_CACHE_DIR` внутри `$TMPDIR`).
- Тесты: `bun test`; один файл — `bun test tests/model-choice.test.ts`; один тест — `bun test -t "<часть имени>"`. Тесты работают с фейковым `$`; в `tests/fixtures/` лежат реальные ответы Jev от TypeSafe и OpenRouter.
- Проверка типов: `bun run typecheck` — `tsc -p .` для хуков и `tsc -p cli` для CLI (`tests/` не входят: там типы `bun:test`).
- Подсказки Jev по СТ: `bun run cli/verify.ts requirements <файл.md> [--json]`; сверка с локальным источником — `bun run cli/verify.ts sources <файл.md> --source <источник> [--json]` (только «не выдумано ли»: потерянные ограничения источника не ищутся); шаги плана — `bun run cli/verify.ts plan-steps <план.md> [--json]`; из песочницы — с `allowed_domains` для `api.typesafe.ai` и `openrouter.ai`. В `--json` поле `measurements` хранит значения всех сигналов, включая не подсказываемый `several_rules`.
- Проверка плагина: `claude plugin validate .claude-plugin/plugin.json` — показывает хуки, вызовы `$` и читаемые переменные окружения. `claude plugin validate .` проверяет только `marketplace.json`: репозиторий одновременно маркетплейс.
- Запуск с плагином из исходников: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`
- Какая модель реально отвечала: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p "<промпт>" --plugin-dir . --output-format json` → поле `modelUsage`. Строки `$.ui.log` в режиме `-p` не выводятся, их видно только в интерактивной сессии.
- `claude plugin test` в 2.1.278 нет, поэтому `claude-code/testing` не используется.
