import { describe, expect, test } from 'bun:test'
import { requirementsOf } from '../../cli/extract'
import { passagesOf, shortlist } from '../../cli/passages'
import { findingsOf, locateQuestions, RELATION_QUESTIONS } from '../../cli/verifiers/sources'
import { parseJevResponse } from '../../hooks/core/response'

const dir = `${import.meta.dir}/../fixtures/sources`

const parse = <Q extends Parameters<typeof parseJevResponse>[1]>(response: unknown, questions: Q) => {
  const r = parseJevResponse({ status: 200, text: JSON.stringify(response) }, questions)
  if (!r.ok) throw new Error(JSON.stringify(r))
  return r.answers
}

describe('findingsOf on recorded Jev answers', async () => {
  const passages = passagesOf(await Bun.file(`${dir}/source.md`).text())
  const items = requirementsOf(await Bun.file(`${dir}/artifact.md`).text())
  const expected: Record<string, [string, string, string | undefined][]> = {
    'FR-1': [],
    'FR-2': [],
    'FR-3': [],
    'FR-4': [['contradicts', 'flag', 'p2']],
    'FR-5': [['contradicts', 'flag', 'p1']],
    'FR-6': [['unsupported', 'flag', undefined]],
  }
  for (const item of items) {
    test(item.id, async () => {
      const f = await Bun.file(`${dir}/${item.id}.json`).json()
      const locateQs = locateQuestions(shortlist(item.text, passages))
      expect(f.locate.questions).toEqual(locateQs)
      const located = parse(f.locate.response, locateQs)
      let relation
      if (f.relation !== null) {
        expect(f.relation.questions).toEqual(RELATION_QUESTIONS)
        relation = parse(f.relation.response, RELATION_QUESTIONS)
      }
      const got = findingsOf(item, located, relation, passages).map((x) => [x.signal, x.zone, x.passage?.id])
      expect(got).toEqual(expected[item.id]!)
    })
  }
})

describe('findingsOf rules', () => {
  const item = { id: 'FR-9', line: 7, text: 't' }
  const passages = [{ id: 'p1', line: 3, text: 'x' }]
  const located = (choice: string, confidence?: number) => ({
    locate: { type: 'choice' as const, choice, ...(confidence === undefined ? {} : { confidence }) },
  })
  const verdict = (choice: 'supports' | 'contradicts' | 'says_nothing', confidence: number) => ({
    relation: { type: 'choice' as const, choice, confidence },
  })

  test('a passage that says nothing leaves the requirement unsupported', () => {
    expect(findingsOf(item, located('p1', 0.9), verdict('says_nothing', 0.9), passages)).toEqual([
      { id: 'FR-9', line: 7, signal: 'unsupported', confidence: 0.9, zone: 'flag', passage: { id: 'p1', line: 3 } },
    ])
  })

  test('a supporting passage raises nothing', () => {
    expect(findingsOf(item, located('p1', 0.9), verdict('supports', 0.95), passages)).toEqual([])
  })

  test('below 0.8 confidence the verdict is left to discretion', () => {
    expect(findingsOf(item, located('p1', 0.9), verdict('contradicts', 0.79), passages)[0]!.zone).toBe('discretion')
    expect(findingsOf(item, located('none', 0.6), undefined, passages)[0]!.zone).toBe('discretion')
    expect(findingsOf(item, located('none'), undefined, passages)[0]!.zone).toBe('discretion')
  })
})
