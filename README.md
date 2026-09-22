# jev-box

[English](README.en.md) · **Русский**

Плагин для Claude Code, который перед каждым ходом решает, какая модель Claude на него нужна. Простые запросы («переименуй переменную») уходят на дешёвую модель, сложные («спроектируй миграцию») — на сильную. Решение принимает [Jev](https://typesafe.ai/) от TypeSafe — модель, которая не пишет текст, а выбирает вариант из списка и возвращает уверенность. Вызывать Jev можно напрямую у TypeSafe или через [OpenRouter](https://openrouter.ai/typesafe).

Плагин работает на **Function Hooks** — preview-механизме Claude Code, включаемом переменной окружения `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS`. Без неё плагин ничего не делает.

## Что делает

- **Главный цикл.** На каждый промпт спрашивает Jev, какую модель из вашего списка взять, и отправляет все запросы этого хода на неё.
- **Сабагенты.** Для сабагентов перечисленных типов (по умолчанию `general-purpose`) модель выбирается так же, по описанию задачи. Форки и вызовы, где модель указана явно, не трогаются.
- **Окно контекста.** Модель предлагается, только если текущий контекст занимает не больше заданной доли её окна (по умолчанию половину). Длинная сессия не переедет на модель с маленьким окном.
- **Сбои.** Если Jev не ответил за таймаут, вернул ошибку, выбрал модель не из списка или конфиг сломан, ход идёт на модели сессии как обычно. Сбой пишется одной строкой в транскрипт.
- **Не трогает.** `effort` и резервную модель, на которую Claude Code переключается сам.

## Требования

- **Claude Code с preview-рантаймом Function Hooks.** Проверено на 2.1.278. По сторонним статьям рантайм есть с 2.1.260.
- **Ключ API** TypeSafe или OpenRouter. Используется только один провайдер — тот, что указан в конфиге.
- **Для разработки** — [Bun](https://bun.sh/) 1.3+. Для работы плагина Bun не нужен.

## Установка

### 1. Поставить плагин

Репозиторий одновременно является маркетплейсом плагинов Claude Code. Добавьте его и установите плагин:

```bash
# из локальной копии
claude plugin marketplace add /путь/к/claude_model_choice

# или с GitHub, если репозиторий опубликован (подставьте свой owner/repo)
claude plugin marketplace add <owner>/<repo>

claude plugin install jev-box@jev-box
```

По умолчанию плагин ставится для пользователя (`--scope user`). Для одного проекта используйте `--scope project` или `--scope local`.

Чтобы попробовать без установки, запустите Claude Code прямо с каталогом плагина:

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude --plugin-dir /путь/к/claude_model_choice
```

### 2. Создать конфиг

```bash
mkdir -p ~/.config/jev-box
cp /путь/к/claude_model_choice/config.example.json ~/.config/jev-box/config.json
chmod 600 ~/.config/jev-box/config.json
```

Откройте `~/.config/jev-box/config.json` и заполните:

- **`provider`** — `"openrouter"` или `"typesafe"`;
- **`apiKey`** в секции выбранного провайдера;
- **`description`** у моделей — по этим описаниям Jev сравнивает задачу. Пишите их под свои задачи, лучше на английском.

Ключи лежат в этом же файле, поэтому права `600` обязательны: читать файл должен только ваш пользователь.

### 3. Включить Function Hooks

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude
```

Чтобы не набирать переменную каждый раз, добавьте её в профиль оболочки (`~/.zshrc`, `~/.bashrc`):

```bash
export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
```

### 4. Проверить

```bash
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude -p "Reply with the single word: pong" \
  --model claude-opus-5 --output-format json | grep -o '"modelUsage":{"[^"]*'
```

Если плагин работает, в `modelUsage` будет `claude-haiku-4-5` вместо `claude-opus-5`: Jev счёл запрос простым. Если модель не поменялась, откройте интерактивную сессию и отправьте любой промпт: причина будет в строке `jev-box: …` в транскрипте (в режиме `-p` эти строки не выводятся).

## Конфиг

Файл: `~/.config/jev-box/config.json`. Шаблон — [`config.example.json`](config.example.json). Конфиг перечитывается перед каждой классификацией, так что правки действуют без перезапуска.

| Поле | Обязательно | По умолчанию | Что задаёт |
|---|---|---|---|
| `provider` | да | — | `"typesafe"` или `"openrouter"`: через кого вызывать Jev |
| `models` | да | — | Модели, из которых выбирает Jev, от 1 до 255 |
| `models[].id` | да | — | Полный ID модели Claude, например `claude-opus-5` |
| `models[].description` | да | — | Когда выбирать эту модель |
| `models[].contextWindow` | да | — | Окно контекста модели в токенах |
| `subagentTypes` | нет | `["general-purpose"]` | Типы сабагентов, модель которых выбирает плагин |
| `timeoutMs` | нет | `3000` | Сколько ждать Jev, от 1 до 9000 мс (у хука лимит 10 с) |
| `contextReserve` | нет | `0.5` | Какую долю окна модели может занимать текущий контекст, чтобы модель осталась в списке |
| `minConfidence` | нет | — | Порог уверенности Jev от 0 до 1; ниже порога ход остаётся на модели сессии |
| `typesafe.apiKey` | если `provider = typesafe` | — | Ключ TypeSafe |
| `typesafe.model` | нет | `jev-latest` | Модель Jev у TypeSafe |
| `openrouter.apiKey` | если `provider = openrouter` | — | Ключ OpenRouter |
| `openrouter.model` | нет | `~typesafe/jev-latest` | Модель Jev в OpenRouter |

## Строки в транскрипте

| Строка | Что случилось |
|---|---|
| `jev-box: config ignored, rule N failed at <поле>` | Конфиг не прошёл проверку; плагин ничего не делает до исправления. Номер правила — из FR-4 в [требованиях](docs/requirements/model_choice.md) |
| `jev-box: <провайдер> timeout` | Jev не ответил за `timeoutMs` |
| `jev-box: <провайдер> network` | Не удалось отправить запрос |
| `jev-box: <провайдер> http_<код>` | Провайдер вернул ошибку, например `http_401` — неверный ключ, `http_402` — кончились кредиты OpenRouter |
| `jev-box: <провайдер> bad_response` | Ответ не удалось разобрать |
| `jev-box: <провайдер> unknown_model` | Jev выбрал модель не из списка |
| `jev-box: internal`, `jev-box: <провайдер> internal` | Внутренняя ошибка плагина; провайдер указывается, если конфиг уже прочитан |

Во всех этих случаях ход идёт на модели сессии.

## Что стоит знать

- **Текст уходит провайдеру.** Каждый промпт и каждое задание сабагента целиком отправляются TypeSafe или OpenRouter.
- **Кэш промпта.** У каждой модели свой кэш, поэтому смена модели между ходами означает повторную запись контекста в кэш. Внутри одного хода модель не меняется.
- **Задержка.** Классификация добавляет к ходу время ответа Jev — на практике 1–2,5 с.
- **Preview-API.** Function Hooks — preview-API, и в следующих версиях Claude Code он может измениться.

## Разработка

```bash
bun install          # в песочнице Claude Code: BUN_TMPDIR="$TMPDIR" bun install
bun test             # все тесты
bun test tests/jev.test.ts        # один файл
bun test -t "fork"                # тесты по части имени
./node_modules/.bin/tsc -p .      # проверка типов
claude plugin validate .                           # манифест маркетплейса
claude plugin validate .claude-plugin/plugin.json  # плагин и хуки
```

Требования к поведению — [`docs/requirements/model_choice.md`](docs/requirements/model_choice.md), заметки для Claude Code — [`CLAUDE.md`](CLAUDE.md).
