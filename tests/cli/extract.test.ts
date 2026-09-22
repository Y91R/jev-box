import { describe, expect, test } from 'bun:test'
import { requirementsOf, stepsOf } from '../../cli/extract'

const root = `${import.meta.dir}/../..`
const st = () => Bun.file(`${root}/docs/requirements/model_choice.md`).text()

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
