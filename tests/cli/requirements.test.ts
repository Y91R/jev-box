import { describe, expect, test } from 'bun:test'
import { findingsOf, measurementOf, QUESTIONS } from '../../cli/verifiers/requirements'
import { parseJevResponse } from '../../hooks/core/response'

const fixture = (name: string) =>
  Bun.file(`${import.meta.dir}/../fixtures/requirements/${name}.json`).json()

const item = { id: 'X', line: 1, text: 'x' }

const answers = (observable: number, several_rules: number, vague_word: number) => ({
  observable: { type: 'noul' as const, noul: observable },
  several_rules: { type: 'noul' as const, noul: several_rules },
  vague_word: { type: 'noul' as const, noul: vague_word },
})

describe('findingsOf on recorded Jev answers', () => {
  const expected: Record<string, [string, 'flag' | 'discretion'][]> = {
    'FR-1': [],
    'FR-13': [],
    'FR-17': [],
    'FR-24': [],
    'bad-vague': [['vague_word', 'flag']],
    'bad-several': [],
    'bad-correct': [['vague_word', 'flag']],
  }
  for (const [name, flags] of Object.entries(expected)) {
    test(name, async () => {
      const f = await fixture(name)
      expect(f.questions).toEqual(QUESTIONS)
      const parsed = parseJevResponse({ status: 200, text: JSON.stringify(f.response) }, QUESTIONS)
      if (!parsed.ok) throw new Error(JSON.stringify(parsed))
      expect(findingsOf(item, parsed.answers).map((x) => [x.signal, x.zone])).toEqual(flags)
    })
  }
})

describe('findingsOf thresholds', () => {
  test('a low observable is flagged, a middling one left to discretion', () => {
    expect(findingsOf(item, answers(0.2, 0, 0))).toEqual([
      { id: 'X', line: 1, signal: 'observable', value: 0.2, zone: 'flag' },
    ])
    expect(findingsOf(item, answers(0.4, 0, 0))[0]!.zone).toBe('discretion')
    expect(findingsOf(item, answers(0.6, 0, 0))).toEqual([])
  })

  test('a high vague_word is flagged, a middling one left to discretion', () => {
    expect(findingsOf(item, answers(1, 0, 0.75)).map((x) => [x.signal, x.zone])).toEqual([
      ['vague_word', 'flag'],
    ])
    expect(findingsOf(item, answers(1, 0, 0.55))[0]!.zone).toBe('discretion')
    expect(findingsOf(item, answers(1, 0, 0.45))).toEqual([])
  })

  test('several_rules is measured but never hinted', async () => {
    expect(findingsOf(item, answers(1, 0.99, 0))).toEqual([])
    const f = await fixture('bad-several')
    const parsed = parseJevResponse({ status: 200, text: JSON.stringify(f.response) }, QUESTIONS)
    if (!parsed.ok) throw new Error(JSON.stringify(parsed))
    expect(measurementOf(item, parsed.answers).values.several_rules).toBe(0.92)
  })
})
