# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Назначение

Плагин `jev-box` для Claude Code на **Function Hooks** (TypeScript-модули, preview-рантайм). На каждый ход пользователя и на запуск сабагентов разрешённых типов он выбирает модель Claude из списка в конфиге. Решение всегда принимает **Jev** от TypeSafe; провайдер задаёт только канал: напрямую (`api.typesafe.ai/v1/systemone`) или через **OpenRouter** (`openrouter.ai/api/alpha/decisions`), формат запроса и ответа у них один. `effort` плагин не выбирает. Без переменной `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS` плагин ничего не делает (FR-24).

Требования: `docs/requirements/model_choice.md`. Это источник истины по поведению, схеме конфига и обработке ошибок; при расхождении с этим файлом прав СТ.

Статус: кода ещё нет.

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
- `next` в хуке вызывается ровно один раз: для `turn.step` каждый вызов — новый запрос к модели, для `agent.spawn` — новый сабагент. Упавший хук движок пропускает сам.

## Конфиг

`~/.config/jev-box/config.json` (шаблон — `config.example.json`): провайдер, ключи, список моделей (`id`, `description`, `contextWindow`), `subagentTypes`, `timeoutMs` (не больше 9000: у хука лимит 10 с), `minConfidence`. Ключи лежат в этом же файле. `userConfig` в `plugin.json` и переменные окружения для настроек не используются. Конфиг перечитывается перед каждой классификацией.

## Команды

- Запуск с плагином из исходников: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir .`
- Проверка типов: `tsc -p tsconfig.json`. За основу брать `mods/tsconfig.json` апстрима: `strict`, `noUncheckedIndexedAccess`, `moduleResolution: bundler`, `noEmit`, include `types` и `hooks`.
- Проверка манифеста: `claude plugin validate .`
- Тесты пишутся на `claude-code/testing` (`tier`, `describe`, `test`, `mock.env/store/clock`). Апстрим запускает их через `claude plugin test <dir>`, но в `claude plugin --help` версии 2.1.278 этой подкоманды нет. Перед использованием проверить.
