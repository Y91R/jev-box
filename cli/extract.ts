export type Item = { id: string; line: number; text: string }

export type Step = Item & { check?: string; paths: string[] }

// Номер с префиксом документа (`SUB-FR-3`) — тоже требование: так нумеруют второй СТ одного сервиса.
const REQUIREMENT = /^- \*\*((?:[A-Z]+-)?N?FR)-(\d+)/

// Требование без кода называется словами: `- **Перенос одним коммитом.** …`. Такой пункт
// считается требованием только в разделах требований — иначе им стал бы любой жирный пункт.
const NAMED_REQUIREMENT = /^- \*\*([^*]+?)\.\*\*/
const REQUIREMENT_SECTIONS = new Set(['Функциональные требования', 'Нефункциональные требования'])

// Пункт требования продолжается строками с отступом (блоки кода, вложенные списки)
// и пустыми строками между ними; первая строка без отступа его закрывает.
export function requirementsOf(markdown: string): Item[] {
  const items: Item[] = []
  let current: { id: string; line: number; lines: string[] } | undefined
  const inCode = codeTracker()
  let inRequirements = false
  const close = () => {
    if (current) items.push({ id: current.id, line: current.line, text: current.lines.join('\n').trim() })
    current = undefined
  }
  for (const [i, line] of markdown.split('\n').entries()) {
    const fenced = inCode(line)
    if (!fenced && line.startsWith('## ')) inRequirements = REQUIREMENT_SECTIONS.has(line.slice(3).trim())
    const m = REQUIREMENT.exec(line)
    const named = !m && !fenced && inRequirements ? NAMED_REQUIREMENT.exec(line) : null
    if (m || named) {
      close()
      current = { id: m ? `${m[1]}-${m[2]}` : named![1]!, line: i + 1, lines: [line.slice(2)] }
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
const TASK_HEADING = /^### Задача (\d+(?:\.\d+)?):/
// В задаче формата plan проверка — пункты чек-листа о тестах и проверках с их строками продолжения:
// шаблон требует тесты отдельными пунктами.
const TASK_CHECK = /^\s*- \[[ xX]\] ((?:тест|прогнать|провер).*)$/iu
const CHECK = '**Проверка:**'
const PATH = /`([^`\s]+)`/g

const pathsOf = (text: string): string[] =>
  [...new Set([...text.matchAll(PATH)].map((m) => m[1]!).filter((t) => t.includes('/') || /\.[a-z]{1,5}$/.test(t)))]

// Шаги плана: «## Шаг N» (шаблон feature-planner), «### N.» под «## Решение» или
// «### Задача N:» (шаблон plan). Строки внутри блоков кода и HTML-комментариев заголовками
// не считаются: в шаблоне plan пример задачи лежит в комментарии. Строка «**Проверка:**»
// с продолжением до пустой строки или пункт чек-листа о тестах — это check, в текст шага он не входит.
export function stepsOf(markdown: string): Step[] {
  const steps: Step[] = []
  let current: { id: string; line: number; level: number; lines: string[]; check: string[] } | undefined
  const inCode = codeTracker()
  let inCheck = false
  let inComment = false
  let inTaskCheck = false
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
    const commented = !fenced && (inComment || line.trimStart().startsWith('<!--'))
    if (commented) inComment = !line.includes('-->')
    const heading = !fenced && !commented && /^#{1,6} /.test(line) ? line.indexOf(' ') : 0
    if (heading > 0) {
      if (current && heading <= current.level) close()
      if (heading === 2) section = line.slice(3).trim()
      const step = STEP_HEADING.exec(line)
      const numbered = section === 'Решение' ? NUMBERED_HEADING.exec(line) : null
      const task = TASK_HEADING.exec(line)
      const m = step ?? numbered ?? task
      if (m) {
        close()
        const id = task ? `Задача ${m[1]}` : `Шаг ${m[1]}`
        current = { id, line: i + 1, level: heading, lines: [line.replace(/^#+\s*/, '')], check: [] }
        inCheck = false
        inTaskCheck = false
        continue
      }
    }
    if (!current) continue
    const isTask = current.id.startsWith('Задача')
    const taskCheck = !fenced && isTask ? TASK_CHECK.exec(line) : null
    if (taskCheck) {
      inCheck = false
      inTaskCheck = true
      current.check.push(taskCheck[1]!.trim())
    } else if (inTaskCheck && /^\s+\S/.test(line) && !/^\s*- /.test(line)) {
      current.check.push(line.trim())
    } else if (!fenced && line.startsWith(CHECK)) {
      inTaskCheck = false
      inCheck = true
      current.check.push(line.slice(CHECK.length))
    } else if (inCheck && line.trim() !== '') {
      current.check.push(line.trim())
    } else {
      inCheck = false
      inTaskCheck = false
      current.lines.push(line)
    }
  }
  close()
  return steps
}

export type Fragment = {
  id: string
  line: number
  kind: 'paragraph' | 'item' | 'row' | 'heading'
  text: string
  section: string
  depth?: number
  list?: number
}

const LIST_ITEM = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/
const TABLE_SEPARATOR = /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/

export const wordsOf = (text: string): number =>
  (text.replace(/`[^`]*`/g, ' w ').match(/[\p{L}\p{N}]+/gu) ?? []).length

// Фрагменты для проверки читаемости: абзац, пункт списка с продолжением (вложенный пункт —
// отдельный фрагмент), строка таблицы без шапки и разделителя, заголовок. Блоки кода,
// YAML-шапка и HTML-комментарии текстом документа не считаются.
export function fragmentsOf(markdown: string): Fragment[] {
  const lines = markdown.split('\n')
  const fragments: Fragment[] = []
  const inCode = codeTracker()
  let current: (Omit<Fragment, 'text'> & { indent: number; lines: string[] }) | undefined
  let section = ''
  let inComment = false
  let list = 0
  let listOpen = false
  const indents: number[] = []
  const close = () => {
    if (current) {
      const { indent: _, lines: body, ...fragment } = current
      fragments.push({ ...fragment, text: body.join('\n').trim() })
    }
    current = undefined
  }
  const breakList = () => {
    listOpen = false
    indents.length = 0
  }

  let start = 0
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end !== -1) start = end + 1
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!
    if (inCode(line)) {
      close()
      breakList()
      continue
    }
    if (inComment || line.trimStart().startsWith('<!--')) {
      close()
      inComment = !line.includes('-->')
      continue
    }
    const at = { id: String(i + 1), line: i + 1, section }
    if (line.trim() === '') {
      if (current?.kind !== 'item') close()
      continue
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      close()
      breakList()
      section = heading[2]!.trim()
      fragments.push({ ...at, section, kind: 'heading', text: section })
      continue
    }
    if (line.trimStart().startsWith('|')) {
      close()
      breakList()
      if (TABLE_SEPARATOR.test(line) || TABLE_SEPARATOR.test(lines[i + 1] ?? '')) continue
      fragments.push({ ...at, kind: 'row', text: line.trim().replace(/^\||\|$/g, '').trim().replace(/\s*\|\s*/g, ' | ') })
      continue
    }
    const item = LIST_ITEM.exec(line)
    if (item) {
      close()
      const indent = item[1]!.length
      if (!listOpen) {
        list++
        listOpen = true
      }
      while (indents.length > 0 && indents[indents.length - 1]! > indent) indents.pop()
      if (indents[indents.length - 1] !== indent) indents.push(indent)
      current = { ...at, kind: 'item', depth: indents.length - 1, list, indent, lines: [item[2]!] }
      continue
    }
    const indent = line.length - line.trimStart().length
    if (current?.kind === 'item' && indent > current.indent) {
      current.lines.push(line.trim())
      continue
    }
    if (current?.kind === 'paragraph') {
      current.lines.push(line.trim())
      continue
    }
    close()
    breakList()
    current = { ...at, kind: 'paragraph', indent, lines: [line.trim()] }
  }
  close()
  return fragments
}
