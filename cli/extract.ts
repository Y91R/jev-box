export type Item = { id: string; line: number; text: string }

export type Step = Item & { check?: string; paths: string[] }

// Номер с префиксом документа (`SUB-FR-3`) — тоже требование: так нумеруют второй СТ одного сервиса.
const REQUIREMENT = /^- \*\*((?:[A-Z]+-)?N?FR)-(\d+)/

// Пункт требования продолжается строками с отступом (блоки кода, вложенные списки)
// и пустыми строками между ними; первая строка без отступа его закрывает.
export function requirementsOf(markdown: string): Item[] {
  const items: Item[] = []
  let current: { id: string; line: number; lines: string[] } | undefined
  const close = () => {
    if (current) items.push({ id: current.id, line: current.line, text: current.lines.join('\n').trim() })
    current = undefined
  }
  for (const [i, line] of markdown.split('\n').entries()) {
    const m = REQUIREMENT.exec(line)
    if (m) {
      close()
      current = { id: `${m[1]}-${m[2]}`, line: i + 1, lines: [line.slice(2)] }
    } else if (current && (line === '' || line.startsWith(' ') || line.startsWith('\t'))) {
      current.lines.push(line)
    } else {
      close()
    }
  }
  close()
  return items
}

// Ограда блока кода по CommonMark: ``` или ~~~ (три и больше), отступ до трёх пробелов;
// закрывает ограда того же символа, не короче открывающей, без текста после неё.
const FENCE = /^ {0,3}(`{3,}|~{3,})/

export function codeTracker(): (line: string) => boolean {
  let open: string | undefined
  return (line) => {
    const m = FENCE.exec(line)
    if (open === undefined) {
      if (m) open = m[1]!
      return m !== null
    }
    const run = m?.[1]
    if (run !== undefined && run[0] === open[0] && run.length >= open.length && line.trim() === run) open = undefined
    return true
  }
}

const STEP_HEADING = /^## Шаг (\d+)\.?/
const NUMBERED_HEADING = /^### (\d+)\.\s/
const CHECK = '**Проверка:**'
const PATH = /`([^`\s]+)`/g

const pathsOf = (text: string): string[] =>
  [...new Set([...text.matchAll(PATH)].map((m) => m[1]!).filter((t) => t.includes('/') || /\.[a-z]{1,5}$/.test(t)))]

// Шаги плана: «## Шаг N» (шаблон feature-planner) или «### N.» под «## Решение».
// Строки внутри блоков кода заголовками не считаются. Строка «**Проверка:**» с продолжением
// до пустой строки — это check, в текст шага она не входит.
export function stepsOf(markdown: string): Step[] {
  const steps: Step[] = []
  let current: { id: string; line: number; level: number; lines: string[]; check: string[] } | undefined
  const inCode = codeTracker()
  let inCheck = false
  let section = ''
  const close = () => {
    if (current) {
      const text = current.lines.join('\n').trim()
      steps.push({
        id: current.id,
        line: current.line,
        text,
        ...(current.check.length === 0 ? {} : { check: current.check.join(' ').trim() }),
        paths: pathsOf(text),
      })
    }
    current = undefined
  }
  for (const [i, line] of markdown.split('\n').entries()) {
    const fenced = inCode(line)
    const heading = !fenced && /^#{1,6} /.test(line) ? line.indexOf(' ') : 0
    if (heading > 0) {
      if (current && heading <= current.level) close()
      if (heading === 2) section = line.slice(3).trim()
      const step = STEP_HEADING.exec(line)
      const numbered = section === 'Решение' ? NUMBERED_HEADING.exec(line) : null
      const m = step ?? numbered
      if (m) {
        close()
        current = { id: `Шаг ${m[1]}`, line: i + 1, level: heading, lines: [line.replace(/^#+\s*/, '')], check: [] }
        inCheck = false
        continue
      }
    }
    if (!current) continue
    if (!fenced && line.startsWith(CHECK)) {
      inCheck = true
      current.check.push(line.slice(CHECK.length))
    } else if (inCheck && line.trim() !== '') {
      current.check.push(line.trim())
    } else {
      inCheck = false
      current.lines.push(line)
    }
  }
  close()
  return steps
}
