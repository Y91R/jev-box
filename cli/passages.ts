export type Passage = { id: string; line: number; heading?: string; text: string }

const STEM = 5
const STOP = new Set(
  [
    'система', 'должна', 'должен', 'может', 'могут', 'который', 'только', 'также', 'после',
    'перед', 'через', 'когда', 'тогда', 'чтобы', 'этого', 'этому', 'такой', 'такие',
  ].map((w) => w.slice(0, STEM)),
)

// Абзацы и пункты списков — фрагменты; заголовок фрагментом не бывает, но идёт к нему контекстом.
export function passagesOf(markdown: string): Passage[] {
  const passages: Passage[] = []
  let heading: string | undefined
  let block: { line: number; lines: string[] } | undefined
  const close = () => {
    if (block) {
      passages.push({
        id: `p${passages.length + 1}`,
        line: block.line,
        ...(heading === undefined ? {} : { heading }),
        text: block.lines.join(' ').trim(),
      })
    }
    block = undefined
  }
  for (const [i, raw] of markdown.split('\n').entries()) {
    const line = raw.trim()
    if (line === '') {
      close()
    } else if (line.startsWith('#')) {
      close()
      heading = line.replace(/^#+\s*/, '')
    } else if (/^([-*]|\d+\.)\s/.test(line)) {
      close()
      block = { line: i + 1, lines: [line.replace(/^([-*]|\d+\.)\s+/, '')] }
    } else if (block) {
      block.lines.push(line)
    } else {
      block = { line: i + 1, lines: [line] }
    }
  }
  close()
  return passages
}

export const stemsOf = (text: string): Set<string> =>
  new Set(
    text
      .toLowerCase()
      .replace(/ё/g, 'е')
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3)
      .map((w) => w.slice(0, STEM))
      .filter((s) => !STOP.has(s)),
  )

// Короткий список по пересечению основ: Jev видит только его, а не весь источник.
export function shortlist(requirement: string, passages: readonly Passage[], n = 20): Passage[] {
  const wanted = stemsOf(requirement)
  return passages
    .map((p, order) => {
      const have = stemsOf(`${p.heading ?? ''} ${p.text}`)
      let score = 0
      for (const s of wanted) if (have.has(s)) score++
      return { p, score, order }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, n)
    .map((x) => x.p)
}
