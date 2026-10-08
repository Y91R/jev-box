import { describe, expect, test } from 'bun:test'
import { fragmentsOf, type Fragment } from '../../cli/extract'
import {
  codeFindingsOf,
  findingsOf,
  glossaryOf,
  isRussian,
  listFindingsOf,
  listSeriesOf,
  questionsFor,
  stateOf,
  THRESHOLDS,
} from '../../cli/verifiers/readability'

const paragraph = (text: string): Fragment => ({ id: '1', line: 1, kind: 'paragraph', text, section: 'Раздел' })
const signals = (text: string, plan = false) => codeFindingsOf(paragraph(text), { plan }).map((f) => [f.signal, f.found])

describe('bare_reference', () => {
  for (const [text, found] of [
    ['по FR-8 видно', 'FR-8'],
    ['как в ЭР-FR-22', 'ЭР-FR-22'],
    ['правило EZZ-FR-20.1 действует', 'EZZ-FR-20.1'],
    ['см. §15 там', '§15'],
    ['по п. 2 выше', 'п. 2'],
    ['выбран вариант Б', 'вариант Б'],
    ['код `FR-8` в кавычках', 'FR-8'],
  ]) {
    test(`flags «${text}»`, () => expect(signals(text!)).toEqual([['bare_reference', found]]))
  }

  test('flags a code in a leading bold name', () => {
    const item: Fragment = { id: '1', line: 1, kind: 'item', text: '**FR-8.** Система должна …', section: 'Требования', depth: 0, list: 1 }
    expect(codeFindingsOf(item, { plan: false }).map((f) => f.found)).toEqual(['FR-8'])
  })

  for (const text of [
    'ADR-0043 (независимые статусы титулов) принят',
    'статусы титулов (ADR-0043) независимы',
    'статусы титулов (ADR-0043, ADR-0063) независимы',
    'FR-8 — перенос одним коммитом',
    'кодировка UTF-8 и SHA-256',
    'кодом `ERR-014` отвечает',
    'ПП РФ от 08.09.2006 № 554 п. 9 требует',
  ]) {
    test(`does not flag «${text}»`, () => expect(signals(text)).toEqual([]))
  }
})

describe('line_anchor', () => {
  test('a path with a line is flagged in a spec and allowed in a plan', () => {
    expect(signals('смотри cli/run.ts:120')).toEqual([['line_anchor', 'cli/run.ts:120']])
    expect(signals('смотри cli/run.ts:120', true)).toEqual([])
  })
})

describe('emphasis', () => {
  test('two emphases inside a paragraph are flagged with their count', () => {
    expect(signals('текст **важно** и *ещё* тут')).toEqual([['emphasis', '2 выделения']])
  })

  test('a leading bold name and an emphasis inside a code span are not counted', () => {
    expect(signals('**Название.** Текст с *одним* выделением и `**не выделение**`')).toEqual([])
  })
})

describe('pictograph', () => {
  test('an arrow outside code is flagged, inside a code span it is not', () => {
    expect(signals('вход → выход')).toEqual([['pictograph', '→']])
    expect(signals('вызов `a -> b` в коде')).toEqual([])
  })

  test('an emoji is flagged', () => expect(signals('готово ✅')).toEqual([['pictograph', '✅']]))
})

describe('fragment_list', () => {
  const findings = (md: string) => listFindingsOf(fragmentsOf(md)).map((f) => [f.line, f.found])

  test('three items of up to three words give one flag on the first item', () => {
    expect(findings('- один два\n- три четыре пять\n- шесть\n')).toEqual([[1, '3 пункта, до 3 слов']])
  })

  test('three items of four words are not flagged', () => {
    expect(findings('- раз два три четыре\n- раз два три четыре\n- раз два три четыре\n')).toEqual([])
  })

  test('two neighbouring lists give two flags', () => {
    expect(findings('- а\n- б\n- в\n\nАбзац.\n\n- г\n- д\n- е\n')).toEqual([
      [1, '3 пункта, до 1 слов'],
      [7, '3 пункта, до 1 слов'],
    ])
  })

  test('nested items do not join the parent series, the leading bold is not counted', () => {
    const md = '- **Длинное ведущее название.** а\n  - вложенный пункт с пятью словами тут\n- б\n'
    expect(listSeriesOf(fragmentsOf(md))).toEqual([{ line: 1, length: 2, maxWords: 1 }, { line: 2, length: 1, maxWords: 6 }])
  })
})

describe('Jev questions', () => {
  const heading: Fragment = { id: '1', line: 1, kind: 'heading', text: 'Приёмка короба: как сейчас', section: 'Приёмка короба: как сейчас' }

  test('a heading gets slogan and unexpanded, a paragraph all four, a two-word fragment none', () => {
    expect(Object.keys(questionsFor(heading))).toEqual(['slogan', 'unexpanded'])
    expect(Object.keys(questionsFor(paragraph('Система переносит файлы одним коммитом')))).toEqual([
      'slogan',
      'empty_thesis',
      'unexpanded',
      'term_overload',
    ])
    expect(Object.keys(questionsFor(paragraph('Два слова')))).toEqual([])
  })

  test('the state carries the fragment, its section and the glossary', () => {
    expect(stateOf(paragraph('Текст абзаца'), 'Термин — определение')).toEqual({
      state: { fragment: 'Текст абзаца', section: 'Раздел', glossary: 'Термин — определение' },
      glossaryDropped: false,
    })
  })

  test('a too long glossary is dropped and reported', () => {
    const { state, glossaryDropped } = stateOf(paragraph('Текст'), 'г'.repeat(20_000))
    expect(state).toEqual({ fragment: 'Текст', section: 'Раздел' })
    expect(glossaryDropped).toBe(true)
  })

  test('the glossary is the text of the «Глоссарий» section', () => {
    const md = '# СТ\n\n## Глоссарий\n\n- **Термин** — определение.\n\n## Требования\n\nТекст.'
    expect(glossaryOf(fragmentsOf(md))).toBe('**Термин** — определение.')
    expect(glossaryOf(fragmentsOf('# Без глоссария'))).toBeUndefined()
  })

  test('isRussian: Russian text with code is Russian, an English README is not', () => {
    expect(isRussian(fragmentsOf('Команда `verify.ts readability` печатает таблицу.'))).toBe(true)
    expect(isRussian(fragmentsOf('The plugin ships four skills with Jev hints.'))).toBe(false)
  })

  test('zones follow the per-signal thresholds: at flag, at discretion, just below discretion', () => {
    const f = paragraph('Система переносит файлы одним коммитом')
    const answers = {
      slogan: { type: 'noul' as const, noul: THRESHOLDS.slogan.flag },
      empty_thesis: { type: 'noul' as const, noul: THRESHOLDS.empty_thesis.discretion },
      unexpanded: { type: 'noul' as const, noul: THRESHOLDS.unexpanded.discretion - 0.001 },
      term_overload: { type: 'noul' as const, noul: 0.1 },
    }
    expect(findingsOf(f, answers).map((x) => [x.signal, x.zone])).toEqual([
      ['slogan', 'flag'],
      ['empty_thesis', 'discretion'],
    ])
  })
})

describe('leading bold after a checkbox', () => {
  test('a checklist item with a bold name and one more emphasis is not flagged', () => {
    const item: Fragment = { id: '1', line: 1, kind: 'item', text: '[ ] **Retrieve by ID:** Verify **200 OK** and schema.', section: 'Раздел', depth: 0, list: 1 }
    expect(codeFindingsOf(item, { plan: false })).toEqual([])
  })
})

describe('reference lists are not fragment lists', () => {
  test('items with code spans or links do not form a series', () => {
    const paths = '- `a/b.go` — разбор\n- `c/d.go` — сборка\n- `e/f.go`\n'
    const toc = '- [Общая часть](#общая)\n- [Часть I](#часть-i)\n- [Часть II](#часть-ii)\n'
    expect(listFindingsOf(fragmentsOf(paths))).toEqual([])
    expect(listFindingsOf(fragmentsOf(toc))).toEqual([])
    expect(listFindingsOf(fragmentsOf('- раз\n- два\n- три\n')).length).toBe(1)
  })
})

describe('table rows', () => {
  test('a table row gets no Jev questions', () => {
    const row: Fragment = { id: '1', line: 1, kind: 'row', text: 'поле | тип | правило маппинга на элемент', section: 'Модель' }
    expect(Object.keys(questionsFor(row))).toEqual([])
  })
})

describe('progress prefixes of the plan template', () => {
  const item = (text: string): Fragment => ({ id: '1', line: 1, kind: 'item', text, section: 'Итог', depth: 0, list: 1 })

  test('➕ and ⚠️ at the start of a plan item are not flagged with --plan, elsewhere they are', () => {
    expect(codeFindingsOf(item('➕ новая задача'), { plan: true })).toEqual([])
    expect(codeFindingsOf(item('[x] ⚠️ блокер снят'), { plan: true })).toEqual([])
    expect(codeFindingsOf(item('➕ новая задача'), { plan: false }).map((f) => f.signal)).toEqual(['pictograph'])
    expect(codeFindingsOf(item('новая задача ➕ и стрелка →'), { plan: true }).map((f) => f.found)).toEqual(['➕'])
  })
})
