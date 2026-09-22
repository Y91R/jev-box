export type Item = { id: string; line: number; text: string }

export type Step = Item & { check?: string; paths: string[] }

const REQUIREMENT = /^- \*\*(N?FR)-(\d+)/

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
  let fenced = false
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
    if (line.startsWith('```')) fenced = !fenced
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
