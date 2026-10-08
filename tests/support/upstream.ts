import { codeTracker } from '../../cli/extract'

const BEGIN = '<!-- jev:begin -->'
const END = '<!-- jev:end -->'
const REPLACE = /^<!-- jev:replace "(.+)" -->$/

const withoutFrontmatter = (text: string): string[] => {
  const lines = text.split('\n')
  if (lines[0] !== '---') return lines
  const end = lines.indexOf('---', 1)
  return end === -1 ? lines : lines.slice(end + 1)
}

// Блоки Jev вставляются с пустыми строками вокруг: без схлопывания пустых строк любая вставка
// выглядела бы расхождением с основным набором.
const normalized = (lines: string[]): string[] =>
  lines
    .filter((line, i) => line.trim() !== '' || (i > 0 && lines[i - 1]!.trim() !== ''))
    .join('\n')
    .trim()
    .split('\n')

export function commonText(plugin: string): { lines: string[]; replaced: string[] } {
  const kept: string[] = []
  const replaced: string[] = []
  let openedAt: number | undefined
  for (const [i, line] of withoutFrontmatter(plugin).entries()) {
    const replace = REPLACE.exec(line.trim())
    if (line.trim() === BEGIN || replace) {
      if (openedAt !== undefined) throw new Error(`блок Jev со строки ${openedAt} не закрыт до строки ${i + 1}`)
      openedAt = i + 1
      if (replace) replaced.push(replace[1]!)
    } else if (line.trim() === END) {
      if (openedAt === undefined) throw new Error(`лишний ${END} на строке ${i + 1}`)
      openedAt = undefined
    } else if (openedAt === undefined) {
      kept.push(line)
    }
  }
  if (openedAt !== undefined) throw new Error(`блок Jev со строки ${openedAt} не закрыт`)
  return { lines: normalized(kept), replaced }
}

const levelOf = (line: string): number => /^(#{1,6}) /.exec(line)?.[1]!.length ?? 0

export function upstreamText(snapshot: string, replaced: string[]): string[] {
  let lines = withoutFrontmatter(snapshot)
  for (const heading of replaced) {
    const inCode = codeTracker()
    const fenced = lines.map((line) => inCode(line))
    const start = lines.findIndex((line, i) => !fenced[i] && line === heading)
    if (start === -1) throw new Error(`в основном наборе нет раздела «${heading}»`)
    const level = levelOf(heading)
    let end = start + 1
    while (end < lines.length && (fenced[end] || levelOf(lines[end]!) === 0 || levelOf(lines[end]!) > level)) end++
    lines = [...lines.slice(0, start), ...lines.slice(end)]
  }
  return normalized(lines)
}

export function firstDifference(a: string[], b: string[]): string | undefined {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `строка ${i + 1}: плагин «${a[i] ?? '<нет>'}», основной набор «${b[i] ?? '<нет>'}»`
  }
  return undefined
}
