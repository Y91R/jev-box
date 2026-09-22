import { describe, expect, test } from 'bun:test'
import { requirementsOf } from '../../cli/extract'
import { passagesOf, shortlist } from '../../cli/passages'

const dir = `${import.meta.dir}/../fixtures/sources`

describe('passagesOf', () => {
  test('paragraphs of the reference source, headings as context only', async () => {
    const passages = passagesOf(await Bun.file(`${dir}/source.md`).text())
    expect(passages).toHaveLength(8)
    expect(passages[0]).toEqual({
      id: 'p1',
      line: 3,
      heading: 'Задача: отмена заказа',
      text: 'Пользователь может отменить заказ, пока заказ не передан в доставку.',
    })
    expect(passages[5]!.heading).toBe('Уведомления и склад')
    expect(passages.some((p) => p.text.startsWith('#'))).toBe(false)
  })

  test('list items are separate passages, wrapped lines stay in one', () => {
    const passages = passagesOf('- первый\n  продолжение\n- второй\n\nабзац\nв две строки')
    expect(passages.map((p) => p.text)).toEqual(['первый продолжение', 'второй', 'абзац в две строки'])
  })
})

describe('shortlist', () => {
  test('the reference passage is among the top 3 for every reference requirement', async () => {
    const passages = passagesOf(await Bun.file(`${dir}/source.md`).text())
    const items = requirementsOf(await Bun.file(`${dir}/artifact.md`).text())
    const reference: Record<string, string> = { 'FR-1': 'p1', 'FR-2': 'p3', 'FR-3': 'p6', 'FR-4': 'p2', 'FR-5': 'p1' }
    for (const [id, passage] of Object.entries(reference)) {
      const item = items.find((i) => i.id === id)!
      expect(shortlist(item.text, passages, 3).map((p) => p.id)).toContain(passage)
    }
  })

  test('matches word stems, not whole words', () => {
    const passages = passagesOf('Отмена заказа ведёт к возврату денег.\n\nСклад хранит товары.')
    expect(shortlist('Отменённые заказы возвращаются', passages).map((p) => p.id)).toEqual(['p1'])
  })

  test('a passage sharing nothing but stop words is left out', () => {
    const passages = passagesOf('Система должна хранить журнал.')
    expect(shortlist('Система должна отправлять письма', passages)).toEqual([])
  })
})
