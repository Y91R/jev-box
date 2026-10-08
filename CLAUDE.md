# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Назначение

Плагин `jev-box` для Claude Code поставляет скиллы `/jev-box:analyst-reviewer`, `/jev-box:system-analyst`, `/jev-box:feature-planner` и `/jev-box:review-plan` — копии глобальных скиллов с подсказками **Jev** от TypeSafe: CLI `cli/verify.ts` помечает требования СТ с подозрительной формулировкой или без опоры в источнике и шаги плана без проверяемого критерия; пометки уходят в собственное ревью и в задание codex. Подсказки ничего не блокируют. Jev вызывается напрямую (`api.typesafe.ai/v1/systemone`) или через **OpenRouter** (`openrouter.ai/api/alpha/decisions`), формат запроса и ответа у них один. План и решения — `docs/plans/README.md` (каталог в `.gitignore`).

## Устройство кода

`core/` — ядро клиента Jev, общее для обоих провайдеров: типы вопросов Noul/Choice/Score и их ответов, построение запроса, разбор ответа с проверкой формы.

`cli/` — вызов ядра. `config.ts` читает и проверяет `~/.config/jev-box/config.json` (провайдер, ключи, `timeoutMs`; лишние поля игнорируются). `run.ts` — логика с внедрёнными сетью, таймером, чтением файлов и выводом; `verify.ts` только связывает её с `fetch`, `setTimeout`, `Bun.file`. `extract.ts` разбирает требования `- **FR-N.** …` и шаги плана (`## Шаг N` или `### N.` под `## Решение`, строки в блоках кода заголовками не считаются), `passages.ts` режет источник на фрагменты и отбирает до 20 кандидатов по общим основам слов; `verifiers/requirements.ts`, `verifiers/sources.ts` и `verifiers/plan-steps.ts` держат вопросы, их версию и пороги. Пороги подсказок откалиброваны на наборе `tests/fixtures/calibration` (ключ — первая строка `labels.tsv`: модель Jev, версии вопросов, язык, провайдеры); `tests/cli/calibration.test.ts` считает по набору пропуски и лишние пометки и падает при смене порога или версии вопроса, а CLI пишет в шапке, если ответ пришёл от другой модели или провайдера. Порог `sources` не откалиброван. Отказ слоя — строка `Слой Jev пропущен: <код>` и выход 0; на `network` и `http_403` (так прокси песочницы Claude отвечает на закрытый хост) — с подсказкой про `allowed_domains`.

`skills/` — скиллы плагина; вызывают CLI как `bun run ${CLAUDE_PLUGIN_ROOT}/cli/verify.ts` с `allowed_domains` для `api.typesafe.ai` и `openrouter.ai`, при отказе песочницы — с `dangerouslyDisableSandbox`. Копия `review-plan.sh` принимает абзац подсказок для codex файлом из переменной `JEV_HINTS_FILE` — текст не проходит через командную строку.

## Конфиг

`~/.config/jev-box/config.json`, шаблон — `config.example.json`. Поля: `provider` (`typesafe` | `openrouter`), `timeoutMs` (до 9000), секции `typesafe` и `openrouter` с `apiKey` и `model`. Ключи лежат в этом же файле. Конфиг читается при каждом запуске CLI; ошибка проверки — код `config_rule_N`.

## Команды

- Установка: `bun install` (в песочнице Claude Code — с `BUN_TMPDIR` и `BUN_INSTALL_CACHE_DIR` внутри `$TMPDIR`).
- Тесты: `bun test`; один файл — `bun test tests/cli/run.test.ts`; один тест — `bun test -t "<часть имени>"`. В `tests/fixtures/` лежат реальные ответы Jev от TypeSafe и OpenRouter.
- Проверка типов: `bun run typecheck` — `tsc -p .` для `cli/` и `core/` (`tests/` не входят).
- Подсказки Jev по СТ: `bun run cli/verify.ts requirements <файл.md> [--json]`; сверка с локальным источником — `bun run cli/verify.ts sources <файл.md> --source <источник> [--json]` (только «не выдумано ли»: потерянные ограничения источника не ищутся); шаги плана — `bun run cli/verify.ts plan-steps <план.md> [--json]`; из песочницы — с `allowed_domains` для `api.typesafe.ai` и `openrouter.ai`. В `--json` поле `measurements` хранит значения всех сигналов, включая не подсказываемый `several_rules`.
- Проверка плагина: `claude plugin validate .claude-plugin/plugin.json`. `claude plugin validate .` проверяет только `marketplace.json`: репозиторий одновременно маркетплейс.
