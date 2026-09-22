export type Item = { id: string; line: number; text: string }

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
