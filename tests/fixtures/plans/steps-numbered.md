# План: пример в формате «### N.»

## Контекст

Два шага реального плана.

## Решение

### 3. Запрос и разбор ответа: `hooks/core/request.ts`, `hooks/core/response.ts`
```ts
// request.ts — ни провайдера, ни Config ядро не знает
export type JevRequest = { url: string; init: { method: 'POST'; headers: Record<string, string>; body: string } }
export function buildJevRequest<M extends QuestionMap>(p: {
  url: string; apiKey: string; jevModel: string; state: string; questions: M
}): JevRequest

// response.ts
export type AnswerFailure = {
  key: string
  reason: 'wrong_type' | 'missing_field' | 'out_of_range' | 'choice_not_in_criteria' | 'probabilities_mismatch'
}
export type ParsedAnswers<M extends QuestionMap> =
  | { ok: true; jevModel: string | undefined; answers: AnswerMap<M> }
  | { ok: false; fail: `http_${number}` | 'malformed' }
  | { ok: false; fail: 'invalid'; errors: AnswerFailure[] }
export function parseJevResponse<M extends QuestionMap>(res: { status: number; text: string }, questions: M): ParsedAnswers<M>
export function peekAnswer(text: string, key: string): Record<string, unknown> | undefined // для trace
export function peekModel(text: string): string | undefined                              // поле model ответа
```
Правила `validateAnswer` (порядок: статус → JSON → `answers` объект → каждый ключ вопроса):
- `type` ответа совпадает с типом вопроса, иначе `wrong_type` (сюда же отсутствующий ключ);
- noul: `noul` — число в [0, 1];
- choice: `choice` — строка (`missing_field`) и ключ `criteria` (`choice_not_in_criteria`); `probabilities`, если есть, покрывают все опции (`probabilities_mismatch`) и лежат в [0, 1];
- score: `score` — число в [0, `criteria.length − 1`]; `probabilities`, если есть, имеют ключи `"0"`…`"n−1"`;
- `confidence`, если есть, в [0, 1].

`choice_not_in_criteria` и `probabilities_mismatch` — разные причины: в шаге 5 из первой получается `unknown_model`, из второй — `bad_response`, и перепутать их нельзя.

Новые тесты: `tests/core/request.test.ts`, `tests/core/response.test.ts` (кейсы — в «Тестах»), в том числе на фикстурах шага 1.

**Проверка:** `bun test tests/core` — зелёный; каждая мутация из «Тестов» для `core/` роняет свой тест.

Коммит: `feat(core): Jev question types, request builder and validated answer parsing`

### 5. Выбор модели на ядре: `hooks/jev.ts` → `hooks/model-choice.ts`
Файл переименовывается: после рефакторинга это потребитель, а не клиент Jev. `ENDPOINTS`, `QUESTION`, `FailCode`, `Decision`, сигнатуры `buildRequest(config, text, candidates)` и `parseResponse(res, config, candidates)` сохраняются.

- `modelQuestion(candidates)` → `{ model: ChoiceQuestion }` с `criteria` из `description`; `buildRequest` = `buildJevRequest` с url, ключом и моделью активного провайдера.
- `parseResponse` = `parseJevResponse` + перевод: `malformed` → `bad_response`; `invalid` с `choice_not_in_criteria` на ключе `model` → `unknown_model`, остальное `invalid` → `bad_response`; `http_N` как есть; затем порог `minConfidence` ровно как сейчас (задан, а `confidence` нет или меньше → `low_confidence`, равен → проходит).
- `export const QUESTION_VERSION = 1` рядом с `QUESTION`: вопрос, его версия и применение порога живут в одном модуле. Версия растёт при смене смысла формулировки — тогда калибровка `minConfidence` устаревает (§8.4 анализа).
- `answerOf = (text) => peekAnswer(text, 'model')`, `responseModelOf = peekModel`.
- `tests/jev.test.ts` → `tests/model-choice.test.ts`: меняется только путь импорта; плюс кейс «`probabilities` без одной из опций при верном `choice`» → `bad_response`, не `unknown_model`.

**Проверка:** `bun test tests/model-choice.test.ts` — все прежние ожидания зелёные; `git diff -M` по тестовому файлу — только строка импорта и новый кейс; тело запроса на всех прежних кейсах `buildRequest` совпадает с ожидаемым через `toEqual`.

Коммит: `refactor(model-choice): build the model question on the shared Jev core`

## Тесты

- не шаг
