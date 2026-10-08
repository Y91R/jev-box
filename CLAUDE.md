# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Назначение

Плагин `jev-box` для Claude Code поставляет скиллы `/jev-box:analyst`, `/jev-box:analyst-review`, `/jev-box:plan` и `/jev-box:review-plan` — копии скиллов основного набора `blue-tape` с подсказками **Jev** от TypeSafe: CLI `cli/verify.ts` помечает требования СТ с подозрительной формулировкой или без опоры в источнике, задачи плана без проверяемого критерия и нечитаемые места документа (голые машинные ссылки, обилие выделений, лозунги, пустые тезисы); пометки уходят в собственное ревью и в задание codex. Подсказки ничего не блокируют. Jev вызывается напрямую (`api.typesafe.ai/v1/systemone`) или через **OpenRouter** (`openrouter.ai/api/alpha/decisions`), формат запроса и ответа у них один. План и решения — `docs/plans/README.md` (каталог в `.gitignore`).

## Устройство кода

`core/` — ядро клиента Jev, общее для обоих провайдеров: типы вопросов Noul/Choice/Score и их ответов, построение запроса, разбор ответа с проверкой формы.

`cli/` — вызов ядра. `config.ts` читает и проверяет `~/.config/jev-box/config.json` (провайдер, ключи, `timeoutMs`; лишние поля игнорируются). `run.ts` — логика с внедрёнными сетью, таймером, чтением файлов и выводом; `verify.ts` только связывает её с `fetch`, `setTimeout`, `Bun.file`. `extract.ts` разбирает требования (`- **FR-N.** …` где угодно и `- **Название.** …` в разделах «Функциональные требования» и «Нефункциональные требования»), шаги плана (`## Шаг N`, `### N.` под `## Решение` и `### Задача N:`; строки в блоках кода и HTML-комментариях заголовками не считаются) и фрагменты документа для проверки читаемости (`fragmentsOf`), `passages.ts` режет источник на фрагменты и отбирает до 20 кандидатов по общим основам слов; `verifiers/requirements.ts`, `verifiers/sources.ts`, `verifiers/plan-steps.ts` и `verifiers/readability.ts` держат вопросы, их версию и пороги; в `readability.ts` ещё и пометки кода — машинные ссылки, якоря `путь:строка`, выделения, эмодзи и стрелки, списки из обрывков. Пороги подсказок откалиброваны на наборе `tests/fixtures/calibration` (ключ — первая строка `labels.tsv`: модель Jev, версии вопросов, язык, провайдеры); `tests/cli/calibration.test.ts` считает по набору пропуски и лишние пометки и падает при смене порога или версии вопроса, а CLI пишет в шапке, если ответ пришёл от другой модели или провайдера. Порог `sources` не откалиброван. Пороги `readability` откалиброваны на 912 размеченных фрагментах документов freight-forwarding (коммит `2e72d14`, тексты в репозиторий не копируются): смысловые пометки Jev там малоточны (`slogan` — 3 верных из 5, `term_overload` — 7 из 25), `empty_thesis` (вопросы v2) — 2 из 10, `unexpanded` порогом практически выключен; строкам таблиц вопросы Jev не задаются. Отказ слоя — строка `Слой Jev пропущен: <код>` и выход 0; на `network` и `http_403` (так прокси песочницы Claude отвечает на закрытый хост) — с подсказкой про `allowed_domains`.

`skills/` — скиллы плагина, собранные от основного набора `/Users/yar/work/skills/skills`. Общий текст совпадает с ним дословно, всё своё — в блоках `<!-- jev:begin -->` … `<!-- jev:end -->`; раздел основного набора целиком заменяет блок `<!-- jev:replace "<заголовок>" -->` … `<!-- jev:end -->`. Снимок основного набора и коммит лежат в `tests/fixtures/upstream-skills/`, `tests/skills.test.ts` сверяет с ним общий текст, а с `UPSTREAM_SKILLS=<каталог skills основного набора>` — ещё и сам снимок. Скиллы вызывают CLI как `bun run ${CLAUDE_PLUGIN_ROOT}/cli/verify.ts` с `allowed_domains` для `api.typesafe.ai` и `openrouter.ai`, при отказе песочницы — с `dangerouslyDisableSandbox`; codex — через `blue-tape external-review <файл задания>`, абзац подсказок пишется в файл задания, а не в командную строку.

## Конфиг

`~/.config/jev-box/config.json`, шаблон — `config.example.json`. Поля: `provider` (`typesafe` | `openrouter`), `timeoutMs` (до 9000), секции `typesafe` и `openrouter` с `apiKey` и `model`. Ключи лежат в этом же файле. Конфиг читается при каждом запуске CLI; ошибка проверки — код `config_rule_N`.

## Команды

- Установка: `bun install` (в песочнице Claude Code — с `BUN_TMPDIR` и `BUN_INSTALL_CACHE_DIR` внутри `$TMPDIR`).
- Тесты: `bun test`; один файл — `bun test tests/cli/run.test.ts`; один тест — `bun test -t "<часть имени>"`. В `tests/fixtures/` лежат реальные ответы Jev от TypeSafe и OpenRouter.
- Проверка типов: `bun run typecheck` — `tsc -p .` для `cli/` и `core/` (`tests/` не входят).
- Подсказки Jev по СТ: `bun run cli/verify.ts requirements <файл.md> [--json]`; сверка с локальным источником — `bun run cli/verify.ts sources <файл.md> --source <источник> [--json]` (только «не выдумано ли»: потерянные ограничения источника не ищутся); шаги плана — `bun run cli/verify.ts plan-steps <план.md> [--json]`; читаемость — `bun run cli/verify.ts readability <файл.md> [--plan] [--json]` (`--plan` разрешает якоря `путь:строка`); из песочницы — с `allowed_domains` для `api.typesafe.ai` и `openrouter.ai`. В `--json` поле `measurements` хранит значения всех сигналов, включая не подсказываемый `several_rules`.
- Проверка плагина: `claude plugin validate .claude-plugin/plugin.json`. `claude plugin validate .` проверяет только `marketplace.json`: репозиторий одновременно маркетплейс.
