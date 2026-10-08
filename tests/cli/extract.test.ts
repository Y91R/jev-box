import { describe, expect, test } from 'bun:test'
import { fragmentsOf, requirementsOf, stepsOf, wordsOf } from '../../cli/extract'

const root = `${import.meta.dir}/../..`
const st = () => Bun.file(`${root}/tests/fixtures/requirements/model_choice.md`).text()

describe('requirementsOf on the real requirements', () => {
  test('finds every FR and NFR item in document order', async () => {
    const items = requirementsOf(await st())
    expect(items).toHaveLength(29)
    expect(items[0]!.id).toBe('FR-24')
    expect(new Set(items.map((i) => i.id)).size).toBe(29)
  })

  test('an item keeps its code block and nested list', async () => {
    const items = requirementsOf(await st())
    expect(items.find((i) => i.id === 'FR-17')!.text).toContain('```json')
    expect(items.find((i) => i.id === 'FR-26')!.text).toMatch(/\n\s+- /)
  })

  test('the line points at the item start', async () => {
    const text = await st()
    const lines = text.split('\n')
    for (const item of requirementsOf(text)) {
      expect(lines[item.line - 1]).toStartWith(`- **${item.id}`)
    }
  })

  test('text matches the state recorded in the Jev fixtures', async () => {
    const items = requirementsOf(await st())
    for (const id of ['FR-1', 'FR-13', 'FR-17', 'FR-24']) {
      const fixture = await Bun.file(`${root}/tests/fixtures/requirements/${id}.json`).json()
      expect(items.find((i) => i.id === id)!.text).toBe(fixture.state)
    }
  })
})

describe('requirementsOf on small documents', () => {
  test('a non-indented line closes the item', () => {
    const md = '- **FR-1.** Система должна A.\n  продолжение\n\nАбзац после.\n- **FR-2.** Б.'
    expect(requirementsOf(md)).toEqual([
      { id: 'FR-1', line: 1, text: '**FR-1.** Система должна A.\n  продолжение' },
      { id: 'FR-2', line: 5, text: '**FR-2.** Б.' },
    ])
  })

  test('numbers with a document prefix are requirements too', async () => {
    const md = await Bun.file(`${root}/tests/fixtures/requirements/prefixed.md`).text()
    expect(requirementsOf(md).map((i) => i.id)).toEqual(['SUB-FR-1', 'SUB-FR-2', 'SUB-FR-3', 'SUB-NFR-1'])
  })

  test('other list items are not requirements', () => {
    expect(requirementsOf('- обычный пункт\n- **Термин** — определение')).toEqual([])
  })

  test('a document without requirements', () => {
    expect(requirementsOf('# Заголовок\n\nТекст.')).toEqual([])
  })
})

describe('stepsOf', () => {
  const plan = (name: string) => Bun.file(`${root}/tests/fixtures/plans/${name}.md`).text()

  test('"## Шаг N" steps with their checks and paths', async () => {
    const steps = stepsOf(await plan('steps-heading'))
    expect(steps.map((s) => s.id)).toEqual(['Шаг 1', 'Шаг 2', 'Шаг 3', 'Шаг 4', 'Шаг 5'])
    expect(steps.map((s) => s.check !== undefined)).toEqual([true, true, true, true, false])
    expect(steps[2]!.check).toBe('код написан, функция `cacheOf` добавлена.')
    expect(steps[0]!.paths).toEqual(['cli/extract.ts', 'tests/cli/extract.test.ts'])
  })

  test('the check is not part of the step text', async () => {
    for (const s of stepsOf(await plan('steps-heading'))) expect(s.text).not.toContain('**Проверка:**')
  })

  test('a "#" line inside a code block is not a heading', async () => {
    const steps = stepsOf(await plan('steps-heading'))
    expect(steps[3]!.text).toContain('# публикация ветки')
    expect(steps[3]!.check).toContain('проверить глазами')
  })

  test('"### N." steps count only under "## Решение"', async () => {
    const steps = stepsOf(await plan('steps-numbered'))
    expect(steps.map((s) => [s.id, s.line])).toEqual([['Шаг 3', 9], ['Шаг 5', 45]])
    expect(steps.every((s) => s.check !== undefined)).toBe(true)
    expect(stepsOf('## Контекст\n\n### 1. Не шаг\n')).toEqual([])
  })

  test('a document without steps', () => {
    expect(stepsOf('# План\n\nТекст.')).toEqual([])
  })
})

describe('code blocks', () => {
  test('headings inside ~~~ and indented fences are not steps', () => {
    const md = [
      '## Шаг 1. Настоящий', '', '~~~md', '## Шаг 9. Пример', '~~~', '',
      '- пример:', '   ```md', '## Шаг 8. Тоже пример', '   ```', '',
      '**Проверка:** `bun test`.', '',
    ].join('\n')
    const steps = stepsOf(md)
    expect(steps.map((s) => s.id)).toEqual(['Шаг 1'])
    expect(steps[0]!.check).toBe('`bun test`.')
  })

  test('a longer fence is closed only by a fence at least as long', () => {
    const md = ['## Шаг 1. A', '````', '```', '## Шаг 2. Внутри', '````', '## Шаг 3. B'].join('\n')
    expect(stepsOf(md).map((s) => s.id)).toEqual(['Шаг 1', 'Шаг 3'])
  })
})

describe('requirementsOf on named requirements', () => {
  const named = () => Bun.file(`${root}/tests/fixtures/requirements/named.md`).text()

  test('takes bold-named items only inside the requirements sections', async () => {
    expect(requirementsOf(await named()).map((i) => [i.id, i.line])).toEqual([
      ['Перенос одним коммитом', 11],
      ['Отчёт команды', 13],
      ['Код выхода', 21],
    ])
  })

  test('the item keeps its continuation lines', async () => {
    const item = requirementsOf(await named()).find((i) => i.id === 'Перенос одним коммитом')!
    expect(item.text).toBe('**Перенос одним коммитом.** Система должна переносить файлы одним коммитом.\n  Продолжение с отступом.')
  })

  test('the text after the name is not checked, glossary items are skipped', () => {
    const md = '## Глоссарий\n\n- **Термин** — определение.\n\n## Функциональные требования\n\n- **Отчёт.** Скилл должен дать строку.'
    expect(requirementsOf(md).map((i) => i.id)).toEqual(['Отчёт'])
  })
})

describe('stepsOf on plan tasks', () => {
  const tasks = () => Bun.file(`${root}/tests/fixtures/plans/tasks.md`).text()

  test('"### Задача N:" tasks, a task inside an HTML comment is skipped', async () => {
    expect(stepsOf(await tasks()).map((s) => [s.id, s.line])).toEqual([
      ['Задача 1', 12],
      ['Задача 2', 22],
      ['Задача 2.1', 26],
    ])
  })

  test('the check is the test and run checklist items, the paths include the Files block', async () => {
    const [first, second] = stepsOf(await tasks())
    expect(first!.check).toBe('тесты на названия требований Прогнать `bun test tests/cli` — зелёные')
    expect(first!.paths).toEqual(['cli/extract.ts', 'tests/fixtures/requirements/named.md'])
    expect(second!.check).toBeUndefined()
  })

  test('a numbered sub-task does not swallow the next heading', async () => {
    const steps = stepsOf(await tasks())
    expect(steps[1]!.text).not.toContain('Ещё документация')
    expect(steps[2]!.text).not.toContain('Ручная проверка')
  })
})

describe('fragmentsOf', () => {
  const doc = () => Bun.file(`${root}/tests/fixtures/readability/fragments.md`).text()

  test('paragraphs, items, rows and headings with their lines and sections', async () => {
    const got = fragmentsOf(await doc()).map((f) => [f.kind, f.line, f.text, f.section])
    expect(got).toEqual([
      ['heading', 4, 'Документ', 'Документ'],
      ['paragraph', 6, 'Первый абзац\nво второй строке.', 'Документ'],
      ['item', 9, 'Пункт первый\nпродолжение пункта', 'Документ'],
      ['item', 11, 'вложенный пункт', 'Документ'],
      ['item', 12, 'Пункт второй', 'Документ'],
      ['paragraph', 14, 'Абзац между списками.', 'Документ'],
      ['item', 16, 'Нумерованный пункт', 'Документ'],
      ['row', 20, 'id | uuid', 'Документ'],
      ['heading', 31, 'Раздел два', 'Раздел два'],
      ['paragraph', 33, 'Последний абзац.', 'Раздел два'],
    ])
  })

  test('items carry their depth and list, a paragraph starts a new list', async () => {
    const items = fragmentsOf(await doc()).filter((f) => f.kind === 'item')
    expect(items.map((f) => [f.line, f.depth, f.list])).toEqual([
      [9, 0, 1],
      [11, 1, 1],
      [12, 0, 1],
      [16, 0, 2],
    ])
  })

  test('a document of code only has no fragments', () => {
    expect(fragmentsOf('```\n# код\n```\n')).toEqual([])
  })
})

describe('wordsOf', () => {
  test('a code span is one word, hyphens and punctuation split', () => {
    expect(wordsOf('`cli/run.ts` падает, по-прежнему')).toBe(4)
  })
})

describe('stepsOf: checks of plan tasks', () => {
  test('«проверка» and «проверить» items are checks, a wrapped item keeps its continuation', () => {
    const md = [
      '### Задача 1: Переименовать',
      '',
      '- [ ] `git mv a b`',
      '- [ ] проверка: `grep -rn a skills` даёт 0 совпадений',
      '- [ ] тесты на разбор: пустой ввод,',
      '      ошибка формата',
      '- [ ] проверить, что каталог на месте',
    ].join('\n')
    const [task] = stepsOf(md)
    expect(task!.check).toBe(
      'проверка: `grep -rn a skills` даёт 0 совпадений тесты на разбор: пустой ввод, ошибка формата проверить, что каталог на месте',
    )
    expect(task!.text).not.toContain('ошибка формата')
  })
})
