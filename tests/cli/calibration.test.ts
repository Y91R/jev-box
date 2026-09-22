import { describe, expect, test } from 'bun:test'
import * as planSteps from '../../cli/verifiers/plan-steps'
import * as requirements from '../../cli/verifiers/requirements'

const text = await Bun.file(`${import.meta.dir}/../fixtures/calibration/labels.tsv`).text()
const [keyLine, , ...lines] = text.trimEnd().split('\n')

const key = Object.fromEntries(
  keyLine!.replace(/^#\s*/, '').split(' ').map((pair) => pair.split('=') as [string, string]),
)

type Row = { verifier: string; source: string; id: string; signal: string; label: number; value: number }

const rows: Row[] = lines.map((line) => {
  const [verifier, source, id, signal, label, , , typesafe] = line.split('\t')
  return { verifier: verifier!, source: source!, id: id!, signal: signal!, label: Number(label), value: Number(typesafe) }
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
      observable_check: { caught: 12, extra: 1, missed: 0 },
      manual_action: { caught: 5, extra: 1, missed: 0 },
      unverified_behavior: { caught: 5, extra: 1, missed: 3 },
    })
  })
})
