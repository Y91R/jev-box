# jev-box

[English](README.en.md) · **Русский**

Плагин для Claude Code со скиллами, в которых дешёвый проход [Jev](https://typesafe.ai/) от TypeSafe помечает подозрительные требования в СТ и шаги плана без проверяемого критерия. Jev — модель, которая не пишет текст, а отвечает на вопросы о тексте и возвращает уверенность. Вызывать Jev можно напрямую у TypeSafe или через [OpenRouter](https://openrouter.ai/typesafe).

## Скиллы с подсказками Jev

Плагин поставляет четыре скилла — копии глобальных `analyst-reviewer`, `system-analyst`, `feature-planner` и `review-plan` с дешёвым проходом Jev:

- `/jev-box:analyst-reviewer <СТ.md>` — перед ревью codex Jev помечает требования (`- **FR-N.** …`) без наблюдаемого результата и с оценочным словом без порога. Пометки задают порядок собственной проверки и уходят абзацем в задание codex; codex и полное ревью выполняются всегда.
- `/jev-box:system-analyst` — перед сдачей черновик СТ проходит ту же проверку; каждая пометка либо исправляется, либо остаётся с причиной в итоге.
- `/jev-box:feature-planner` — перед самопроверкой сохранённый план проходит проверку шагов: код помечает шаги без строки `**Проверка:**` и без путей файлов, Jev — проверку без команды и результата, ручные действия и опору на поведение чужого кода без способа его проверить.
- `/jev-box:review-plan <план.md>` — та же проверка шагов перед отправкой плана codex; пометки задают порядок собственной проверки и уходят абзацем в задание codex.

Подсказки ничего не блокируют. Пороги откалиброваны предварительно на наборе `tests/fixtures/calibration` (jev-1.13.0, вопросы v1, ru, typesafe); на другой модели или провайдере CLI пишет об этом в шапке вывода. Скиллы вызывают `bun run ${CLAUDE_PLUGIN_ROOT}/cli/verify.ts` и открывают песочнице доступ к `api.typesafe.ai` и `openrouter.ai`; в обычном режиме разрешений Claude Code попросит одобрить вызов без песочницы. Если Jev недоступен, в итоге будет строка «Слой Jev пропущен: <код>», а ревью пройдёт как обычно.

Если у СТ есть локальный источник (файл задачи, бриф), `analyst-reviewer` делает второй проход — сверку с ним: помечает требования, которым источник противоречит (`contradicts`), и требования без опоры в источнике (`unsupported`). Проверяется только «не выдумано ли»: пропущенные в СТ ограничения источника этот проход не ищет.

Те же проходы вручную:

```bash
bun run cli/verify.ts requirements <СТ.md>
bun run cli/verify.ts sources <СТ.md> --source <источник.md>
bun run cli/verify.ts plan-steps <план.md>
```

## Требования

- **Ключ API** TypeSafe или OpenRouter. Используется только один провайдер — тот, что указан в конфиге.
- **[Bun](https://bun.sh/) 1.3+.**

## Установка

### 1. Поставить плагин

Репозиторий одновременно является маркетплейсом плагинов Claude Code. Добавьте его и установите плагин:

```bash
claude plugin marketplace add Y91R/jev-box
claude plugin install jev-box@jev-box
```

По умолчанию плагин ставится для пользователя (`--scope user`). Для одного проекта используйте `--scope project` или `--scope local`.

### 2. Создать конфиг

Создайте `~/.config/jev-box/config.json` по шаблону [`config.example.json`](config.example.json), укажите `provider` и `apiKey` в секции выбранного провайдера и закройте доступ:

```bash
chmod 700 ~/.config/jev-box && chmod 600 ~/.config/jev-box/config.json
```

Ключи лежат в этом же файле, поэтому права `600` обязательны: читать файл должен только ваш пользователь.

## Конфиг

Файл: `~/.config/jev-box/config.json`. Он читается при каждом вызове CLI.

| Поле | Обязательно | По умолчанию | Что задаёт |
|---|---|---|---|
| `provider` | да | — | `"typesafe"` или `"openrouter"`: через кого вызывать Jev |
| `timeoutMs` | нет | `3000` | Сколько ждать Jev, от 1 до 9000 мс |
| `typesafe.apiKey` | если `provider = typesafe` | — | Ключ TypeSafe |
| `typesafe.model` | нет | `jev-latest` | Модель Jev у TypeSafe |
| `openrouter.apiKey` | если `provider = openrouter` | — | Ключ OpenRouter |
| `openrouter.model` | нет | `~typesafe/jev-latest` | Модель Jev в OpenRouter |

Если конфиг не прошёл проверку, CLI пишет `Слой Jev пропущен: config_rule_N`: 1 — файла нет или это не JSON-объект, 2 — `provider`, 3 — `timeoutMs`, 4 — нет ключа выбранного провайдера, 5 — `typesafe.model`, 6 — `openrouter.model`.

## Что стоит знать

- **Текст уходит провайдеру.** Требования, шаги плана и фрагменты источника отправляются TypeSafe или OpenRouter.

## Разработка

```bash
bun install          # в песочнице Claude Code: BUN_TMPDIR="$TMPDIR" bun install
bun test             # все тесты
bun test tests/cli/run.test.ts    # один файл
bun test -t "plan"                # тесты по части имени
bun run typecheck                 # проверка типов
claude plugin validate .                           # манифест маркетплейса
claude plugin validate .claude-plugin/plugin.json  # плагин и скиллы
```

Заметки для Claude Code — [`CLAUDE.md`](CLAUDE.md).
