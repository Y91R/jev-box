import type { AnswerMap, NoulQuestion } from '../../core/questions'
import { wordsOf, type Fragment } from '../extract'

export type CodeSignal = 'bare_reference' | 'line_anchor' | 'emphasis' | 'pictograph' | 'fragment_list'
export type Zone = 'flag' | 'discretion'
export type CodeFinding = { id: string; line: number; signal: CodeSignal; found: string; zone: 'flag' }

// Начальные пороги пометок кода — решение аналитика; окончательные задаёт калибровка.
export const EMPHASIS_MAX = 1
export const LIST_MIN_ITEMS = 3
export const LIST_MAX_WORDS = 3

const CODE = /(?<![\p{L}\p{N}_-])([A-ZА-ЯЁ]{1,6})(?:-[A-ZА-ЯЁ]{1,6})?-\d+(?:\.\d+)?(?![\p{L}\p{N}])/gu
// Стандарты и коды ошибок называют сам код, а не другое место документа.
const NOT_REFERENCES = new Set(['UTF', 'SHA', 'ISO', 'ERR'])
const SECTION_SIGN = /§\s?\d+/gu
const CLAUSE = /(?<![\p{L}])п\.\s?\d+/gu
// «п. N» нормативного акта — ссылка на внешний источник, а не на место документа.
const ACT = /ст\.|№|прил\.|ПП|ФЗ/u
const VARIANT = /(?<![\p{L}])[Вв]ариант[а-я]*\s+[А-ЯЁA-Z](?![\p{L}])/gu
const LINE_ANCHOR = /(?<![\p{L}\p{N}])[\w./-]+\.[a-z]{1,5}:\d+/gu
const LEADING_BOLD = /^(?:\[[ xX]\]\s+)?\*\*[^*]+\*\*/
const BOLD = /\*\*[^*\n]+?\*\*|__[^_\n]+?__/g
const ITALIC = /(?<![*\p{L}\p{N}])\*[^*\n]+?\*(?!\*)|(?<![_\p{L}\p{N}])_[^_\n]+?_(?![_\p{L}\p{N}])/gu
const PICTOGRAPH = /\p{Extended_Pictographic}|[→←↔⇒⇐⇔]|->|=>/u

const withoutCodeSpans = (text: string) => text.replace(/`[^`]*`/g, ' ')
const sentencesOf = (text: string) => text.split(/(?<=[.!?])\s+(?=[А-ЯЁA-Z«])/u)

// Пересказ: скобки сразу после кода, тире со словами после кода или код в скобках после слов.
function retold(text: string, start: number, end: number): boolean {
  const after = text.slice(end)
  if (/^\s*\(/.test(after) || /^\s+—\s+\p{L}/u.test(after)) return true
  const open = text.lastIndexOf('(', start)
  return open !== -1 && !text.slice(open, start).includes(')') && /\p{L}\s*$/u.test(text.slice(0, open))
}

function bareReferencesOf(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(CODE)) {
    if (!NOT_REFERENCES.has(m[1]!) && !retold(text, m.index, m.index + m[0].length)) found.push(m[0])
  }
  for (const re of [SECTION_SIGN, VARIANT]) {
    for (const m of text.matchAll(re)) if (!retold(text, m.index, m.index + m[0].length)) found.push(m[0])
  }
  for (const sentence of sentencesOf(text)) {
    if (ACT.test(sentence)) continue
    for (const m of sentence.matchAll(CLAUSE)) found.push(m[0])
  }
  return found
}

const emphasesOf = (text: string): number => {
  const plain = withoutCodeSpans(text).replace(LEADING_BOLD, '')
  const bold = plain.match(BOLD)?.length ?? 0
  return bold + (plain.replace(BOLD, ' ').match(ITALIC)?.length ?? 0)
}

export function codeFindingsOf(fragment: Fragment, { plan }: { plan: boolean }): CodeFinding[] {
  const at = { id: fragment.id, line: fragment.line, zone: 'flag' as const }
  const findings: CodeFinding[] = bareReferencesOf(fragment.text).map((found) => ({ ...at, signal: 'bare_reference', found }))
  if (!plan) {
    for (const m of fragment.text.matchAll(LINE_ANCHOR)) findings.push({ ...at, signal: 'line_anchor', found: m[0] })
  }
  const emphases = emphasesOf(fragment.text)
  if (emphases > EMPHASIS_MAX) findings.push({ ...at, signal: 'emphasis', found: `${emphases} выделения` })
  const picture = PICTOGRAPH.exec(withoutCodeSpans(fragment.text))
  if (picture) findings.push({ ...at, signal: 'pictograph', found: picture[0] })
  return findings
}

export const emphasisOf = (fragment: Fragment): number => emphasesOf(fragment.text)

export type ListSeries = { line: number; length: number; maxWords: number }

// Пункт с путём, кодом или ссылкой — справочный: перечни файлов и оглавления короткие по
// природе, обрывками мысли они не являются (прогон на корпусе калибровки 2026-10-09).
const REFERENCE = /`[^`]+`|\[[^\]]+\]\([^)]+\)/

// Серия — подряд идущие пункты одного уровня одного списка; вложенные пункты её не рвут
// и в неё не входят, а образуют свои серии.
export function listSeriesOf(fragments: Fragment[]): ListSeries[] {
  const open = new Map<string, ListSeries>()
  const series: ListSeries[] = []
  for (const f of fragments) {
    if (f.kind !== 'item' || REFERENCE.test(f.text)) {
      open.clear()
      continue
    }
    for (const [key, s] of open) if (Number(key.split(':')[1]) > f.depth!) open.delete(key)
    const key = `${f.list}:${f.depth}`
    const words = wordsOf(f.text.replace(LEADING_BOLD, ''))
    const s = open.get(key)
    if (s) {
      s.length++
      s.maxWords = Math.max(s.maxWords, words)
    } else {
      const fresh = { line: f.line, length: 1, maxWords: words }
      open.set(key, fresh)
      series.push(fresh)
    }
  }
  return series.sort((a, b) => a.line - b.line)
}

export function listFindingsOf(fragments: Fragment[]): CodeFinding[] {
  return listSeriesOf(fragments)
    .filter((s) => s.length >= LIST_MIN_ITEMS && s.maxWords <= LIST_MAX_WORDS)
    .map((s) => ({
      id: String(s.line),
      line: s.line,
      signal: 'fragment_list' as const,
      found: `${s.length} пункта, до ${s.maxWords} слов`,
      zone: 'flag' as const,
    }))
}

// Растёт при смене смысла любого вопроса: пороги ниже после этого устаревают.
export const QUESTION_VERSION = 1

export const QUESTIONS = {
  slogan: {
    type: 'noul',
    instructions:
      'Does `fragment` read like a slogan or a poster rather than a plain explanation: a rhyme, a parallelism such as "three parcels, three paths", a dash or a colon used for effect, or pathos?',
  },
  empty_thesis: {
    type: 'noul',
    instructions:
      'Does `fragment` state a general claim with no concrete fact, decision, number or reason, like filler written by a text generator?',
  },
  unexpanded: {
    type: 'noul',
    instructions:
      'Is the thought in `fragment` compressed into labels or fragments so that a colleague cannot understand it without other context?',
  },
  term_overload: {
    type: 'noul',
    instructions:
      'Does `fragment` use so many terms, abbreviations and identifiers that are explained neither in `glossary` nor in `fragment` itself that it is hard to read?',
  },
} satisfies Record<string, NoulQuestion>

export type Signal = keyof typeof QUESTIONS
export type Finding = { id: string; line: number; signal: Signal; value: number; zone: Zone }
export type Answers = Partial<AnswerMap<typeof QUESTIONS>>

// Ключ набора tests/fixtures/calibration/labels.tsv: пороги ниже верны только для него.
export const CALIBRATION = { model: 'jev-1.13.0', questionVersion: 1, language: 'ru', providers: ['typesafe'] } as const

// Подобраны на документах freight-forwarding (tests/fixtures/calibration/labels.tsv). Дефектов на
// сигнал меньше 30, поэтому пороги предварительные. empty_thesis Jev не отделяет от вводных строк
// и заглушек шаблонов: его пороги выше всех значений в корпусе, подсказок он почти не даёт.
export const THRESHOLDS: Record<Signal, { flag: number; discretion: number }> = {
  slogan: { flag: 0.85, discretion: 0.8 },
  empty_thesis: { flag: 0.9, discretion: 0.88 },
  unexpanded: { flag: 0.85, discretion: 0.8 },
  term_overload: { flag: 0.8, discretion: 0.78 },
}
const MIN_WORDS = 3
// Запас под лимит Jev в 32 тысячи токенов на state и самый длинный вопрос.
const MAX_STATE_CHARS = 20_000

export const LIMITATIONS = [
  'пороги откалиброваны предварительно: jev-1.13.0, вопросы v1, ru, typesafe, документы freight-forwarding',
  'пороги slogan, unexpanded, term_overload, emphasis и fragment_list не откалиброваны: в наборе меньше 30 дефектов на сигнал (16, 7, 16, 8 и 0)',
  'порог empty_thesis не откалиброван: вводные строки и заглушки шаблонов Jev оценивает выше настоящих пустых тезисов',
  'смысловые вопросы задаются только фрагментам из трёх слов и больше, строкам таблиц не задаются',
]
export const GLOSSARY_DROPPED = 'глоссарий не передан: слишком длинный'

// Пустой тезис о заголовке не спрашивают: у заголовка нет утверждения. Строка таблицы коротка
// по природе, смысл ей даёт шапка: на корпусе калибровки строки дали большинство ложных
// unexpanded и term_overload.
export function questionsFor(fragment: Fragment): Partial<typeof QUESTIONS> {
  if (fragment.kind === 'row' || wordsOf(fragment.text) < MIN_WORDS) return {}
  if (fragment.kind === 'heading') return { slogan: QUESTIONS.slogan, unexpanded: QUESTIONS.unexpanded }
  return QUESTIONS
}

export function stateOf(fragment: Fragment, glossary: string | undefined) {
  const base = { fragment: fragment.text, section: fragment.section }
  if (glossary === undefined) return { state: base, glossaryDropped: false }
  if (glossary.length + fragment.text.length > MAX_STATE_CHARS) return { state: base, glossaryDropped: true }
  return { state: { ...base, glossary }, glossaryDropped: false }
}

export function glossaryOf(fragments: Fragment[]): string | undefined {
  const body = fragments.filter((f) => f.section === 'Глоссарий' && f.kind !== 'heading').map((f) => f.text)
  return body.length === 0 ? undefined : body.join('\n')
}

export function isRussian(fragments: Fragment[]): boolean {
  const text = fragments.map((f) => f.text.replace(/`[^`]*`/g, ' ')).join(' ')
  const letters = text.match(/\p{L}/gu)?.length ?? 0
  const cyrillic = text.match(/\p{Script=Cyrillic}/gu)?.length ?? 0
  return letters > 0 && cyrillic * 2 >= letters
}

export function findingsOf(fragment: Fragment, answers: Answers): Finding[] {
  const findings: Finding[] = []
  for (const signal of Object.keys(QUESTIONS) as Signal[]) {
    const value = answers[signal]?.noul
    if (value === undefined) continue
    const { flag, discretion } = THRESHOLDS[signal]
    const zone = value >= flag ? 'flag' : value >= discretion ? 'discretion' : undefined
    if (zone !== undefined) findings.push({ id: fragment.id, line: fragment.line, signal, value, zone })
  }
  return findings
}
