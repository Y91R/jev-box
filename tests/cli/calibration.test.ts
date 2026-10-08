import { describe, expect, test } from 'bun:test'
import * as planSteps from '../../cli/verifiers/plan-steps'
import * as readability from '../../cli/verifiers/readability'
import * as requirements from '../../cli/verifiers/requirements'

const text = await Bun.file(`${import.meta.dir}/../fixtures/calibration/labels.tsv`).text()
const [keyLine, , ...lines] = text.trimEnd().split('\n')

const key = Object.fromEntries(
  keyLine!.replace(/^#\s*/, '').split(' ').map((pair) => pair.split('=') as [string, string]),
)

type Row = { verifier: string; source: string; id: string; signal: string; label: number; value: number; raw: string }

const rows: Row[] = lines.map((line) => {
  const [verifier, source, id, signal, label, , , typesafe] = line.split('\t')
  return { verifier: verifier!, source: source!, id: id!, signal: signal!, label: Number(label), value: Number(typesafe), raw: typesafe! }
})

const itemsOf = (verifier: string) => {
  const items = new Map<string, Row[]>()
  for (const row of rows.filter((r) => r.verifier === verifier)) {
    const k = `${row.source}\t${row.id}`
    items.set(k, [...(items.get(k) ?? []), row])
  }
  return [...items.values()]
}

type Tally = { caught: number; extra: number; missed: number }

const tally = (items: Row[][], flagged: (item: Row[]) => Set<string>) => {
  const result: Record<string, Tally> = {}
  for (const item of items) {
    const hits = flagged(item)
    for (const row of item) {
      const t = (result[row.signal] ??= { caught: 0, extra: 0, missed: 0 })
      const hit = hits.has(row.signal)
      if (hit && row.label === 1) t.caught++
      else if (hit) t.extra++
      else if (row.label === 1) t.missed++
    }
  }
  return result
}

const noul = (item: Row[], signal: string) => {
  const row = item.find((r) => r.signal === signal)
  return row === undefined ? undefined : { type: 'noul' as const, noul: row.value }
}

describe('calibration set', () => {
  test('the key matches the code', () => {
    const c = planSteps.CALIBRATION
    expect(key).toMatchObject({ model: c.model, language: c.language, providers: c.providers.join(',') })
    expect(Number(key['plan-steps'])).toBe(c.questionVersion)
    expect(planSteps.QUESTION_VERSION).toBe(c.questionVersion)
    const r = requirements.CALIBRATION
    expect(key).toMatchObject({ model: r.model, language: r.language, providers: r.providers.join(',') })
    expect(Number(key['requirements'])).toBe(r.questionVersion)
    expect(requirements.QUESTION_VERSION).toBe(r.questionVersion)
    const q = readability.CALIBRATION
    expect(key).toMatchObject({ model: q.model, language: q.language, providers: q.providers.join(',') })
    expect(Number(key['readability'])).toBe(q.questionVersion)
    expect(readability.QUESTION_VERSION).toBe(q.questionVersion)
    expect(Number(key['emphasis'])).toBe(readability.EMPHASIS_MAX)
    expect(key['fragment_list']).toBe(`${readability.LIST_MIN_ITEMS}x${readability.LIST_MAX_WORDS}`)
  })

  test('requirements: misses and extra hints stay within the calibrated bounds', () => {
    const got = tally(itemsOf('requirements'), (item) => {
      const answers = {
        observable: noul(item, 'observable')!,
        vague_word: noul(item, 'vague_word')!,
        several_rules: { type: 'noul' as const, noul: 0 },
      }
      return new Set(requirements.findingsOf({ id: item[0]!.id, line: 0, text: '' }, answers).map((f) => f.signal))
    })
    expect(got).toEqual({
      observable: { caught: 3, extra: 1, missed: 2 },
      vague_word: { caught: 8, extra: 0, missed: 1 },
    })
  })

  test('plan steps: misses and extra hints stay within the calibrated bounds', () => {
    const got = tally(itemsOf('plan-steps'), (item) => {
      const check = noul(item, 'observable_check')
      const answers = {
        manual_action: noul(item, 'manual_action')!,
        unverified_behavior: noul(item, 'unverified_behavior')!,
        ...(check === undefined ? {} : { observable_check: check }),
      }
      const step = { id: item[0]!.id, line: 0, text: '', paths: [] }
      return new Set(planSteps.findingsOf(step, answers).map((f) => f.signal))
    })
    expect(got).toEqual({
      // С задачами формата plan (4 плана, 37 задач, 2026-10-09): manual_action дал две лишние
      // пометки в зоне discretion; порог не поднят — иначе пропали бы прогоны на живой системе.
      observable_check: { caught: 13, extra: 1, missed: 1 },
      manual_action: { caught: 9, extra: 3, missed: 1 },
      unverified_behavior: { caught: 5, extra: 1, missed: 4 },
    })
  })

  test('readability: misses and extra hints stay within the calibrated bounds', () => {
    const fragment = { id: '', line: 0, kind: 'paragraph' as const, text: '', section: '' }
    const flagged = (row: Row): boolean => {
      if (row.signal === 'emphasis') return row.value > readability.EMPHASIS_MAX
      if (row.signal === 'fragment_list') {
        const [length, maxWords] = row.raw.split('x').map(Number) as [number, number]
        return length >= readability.LIST_MIN_ITEMS && maxWords <= readability.LIST_MAX_WORDS
      }
      const answers = { [row.signal]: { type: 'noul' as const, noul: row.value } }
      return readability.findingsOf(fragment, answers).length > 0
    }
    const items = rows.filter((r) => r.verifier === 'readability').map((r) => [r])
    const got = tally(items, (item) => new Set(flagged(item[0]!) ? [item[0]!.signal] : []))
    expect(got).toEqual({
      slogan: { caught: 3, extra: 2, missed: 6 },
      empty_thesis: { caught: 2, extra: 2, missed: 0 },
      unexpanded: { caught: 0, extra: 0, missed: 9 },
      term_overload: { caught: 7, extra: 18, missed: 44 },
      emphasis: { caught: 15, extra: 25, missed: 0 },
    })
  })
})
