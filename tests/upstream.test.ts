import { describe, expect, test } from 'bun:test'
import { commonText, firstDifference, upstreamText } from './support/upstream'

const snapshot = [
  '---',
  'name: plan',
  '---',
  '# Скилл',
  '',
  '## Как запускать',
  '',
  '```bash',
  '# не заголовок',
  '```',
  '',
  '### Подраздел',
  '',
  'текст подраздела',
  '',
  '## Дальше',
  '',
  'текст',
].join('\n')

const plugin = (body: string) => `---\nname: plan\ndescription: с Jev\n---\n${body}`

describe('commonText', () => {
  test('drops the frontmatter and Jev blocks with their blank lines', () => {
    const { lines } = commonText(plugin('# Скилл\n\n<!-- jev:begin -->\nпроход Jev\n<!-- jev:end -->\n\nтекст'))
    expect(lines).toEqual(['# Скилл', '', 'текст'])
  })

  test('a replace block names the replaced section', () => {
    const { lines, replaced } = commonText(plugin('# Скилл\n\n<!-- jev:replace "## Как запускать" -->\nсвоё\n<!-- jev:end -->\n'))
    expect(lines).toEqual(['# Скилл'])
    expect(replaced).toEqual(['## Как запускать'])
  })

  test('an unclosed block is an error with its line', () => {
    expect(() => commonText('текст\n<!-- jev:begin -->\nпроход')).toThrow('строки 2')
  })

  test('a stray end is an error', () => {
    expect(() => commonText('текст\n<!-- jev:end -->')).toThrow('лишний')
  })
})

describe('upstreamText', () => {
  test('removes a replaced section up to the next heading of the same level, code lines are not headings', () => {
    expect(upstreamText(snapshot, ['## Как запускать'])).toEqual(['# Скилл', '', '## Дальше', '', 'текст'])
  })

  test('a replaced heading missing from the snapshot is an error naming it', () => {
    expect(() => upstreamText(snapshot, ['## Нет такого'])).toThrow('«## Нет такого»')
  })
})

describe('comparing a plugin skill with the snapshot', () => {
  const synced = plugin(
    '# Скилл\n\n<!-- jev:replace "## Как запускать" -->\nсвоё\n<!-- jev:end -->\n\n## Дальше\n\n<!-- jev:begin -->\nпроход\n<!-- jev:end -->\n\nтекст',
  )

  test('the same common text matches', () => {
    const { lines, replaced } = commonText(synced)
    expect(firstDifference(lines, upstreamText(snapshot, replaced))).toBeUndefined()
  })

  test('one changed word outside the blocks is reported with its line', () => {
    const { lines, replaced } = commonText(synced.replace('текст', 'тест'))
    expect(firstDifference(lines, upstreamText(snapshot, replaced))).toBe(
      'строка 5: плагин «тест», основной набор «текст»',
    )
  })
})
