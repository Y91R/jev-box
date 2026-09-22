import { describe, expect, test } from 'bun:test'
import type { ChoiceQuestion, NoulQuestion, ScoreQuestion } from '../../hooks/core/questions'
import { parseJevResponse, peekAnswer, peekModel } from '../../hooks/core/response'

const fixture = (name: string) =>
  Bun.file(`${import.meta.dir}/../fixtures/${name}.json`).text()

const ok = (body: unknown) => ({ status: 200, text: JSON.stringify(body) })

const recorded = {
  measurable: {
    type: 'noul',
    instructions: 'Does the requirement state a measurable threshold?',
  } as NoulQuestion,
  specificity: {
    type: 'score',
    instructions: 'How specific is the requirement?',
    criteria: ['Vague', 'Partly specific', 'Fully specific'],
  } as ScoreQuestion,
}

const pick: { pick: ChoiceQuestion<'a' | 'b'> } = {
  pick: { type: 'choice', instructions: 'Which?', criteria: { a: 'A', b: 'B' } },
}

const choice = (a: Record<string, unknown>) => ok({ answers: { pick: { type: 'choice', ...a } } })

describe('parseJevResponse on recorded answers', () => {
  for (const [name, model] of [
    ['typesafe-noul-score', 'jev-1.13.0'],
    ['openrouter-noul-score', 'typesafe/jev-1.13-20260917'],
  ] as const) {
    test(name, async () => {
      const r = parseJevResponse({ status: 200, text: await fixture(name) }, recorded)
      if (!r.ok) throw new Error(JSON.stringify(r))
      expect(r.jevModel).toBe(model)
      expect(r.answers.measurable.noul).toBe(0.08)
      expect(r.answers.specificity.score).toBeGreaterThanOrEqual(0)
      expect(r.answers.specificity.score).toBeLessThanOrEqual(2)
      expect(r.answers.specificity.confidence).toBe(0.86)
    })
  }
})

describe('parseJevResponse on choice answers', () => {
  test('full answer', () => {
    const r = parseJevResponse(
      choice({ choice: 'b', probabilities: { a: 0.1, b: 0.9 }, confidence: 0.8 }),
      pick,
    )
    expect(r).toEqual({
      ok: true,
      jevModel: undefined,
      answers: { pick: { type: 'choice', choice: 'b', probabilities: { a: 0.1, b: 0.9 }, confidence: 0.8 } },
    })
  })

  test('no probabilities and no confidence is still an answer', () => {
    expect(parseJevResponse(choice({ choice: 'a' }), pick).ok).toBe(true)
  })

  test('choice outside the criteria', () => {
    expect(parseJevResponse(choice({ choice: 'c' }), pick)).toEqual({
      ok: false,
      fail: 'invalid',
      errors: [{ key: 'pick', reason: 'choice_not_in_criteria' }],
    })
  })

  test('probabilities missing an option', () => {
    expect(parseJevResponse(choice({ choice: 'a', probabilities: { a: 1 } }), pick)).toEqual({
      ok: false,
      fail: 'invalid',
      errors: [{ key: 'pick', reason: 'probabilities_mismatch' }],
    })
  })

  test('choice is not a string', () => {
    expect(parseJevResponse(choice({ choice: 3 }), pick)).toMatchObject({
      errors: [{ key: 'pick', reason: 'missing_field' }],
    })
  })

  test('confidence above one', () => {
    expect(parseJevResponse(choice({ choice: 'a', confidence: 1.2 }), pick)).toMatchObject({
      errors: [{ key: 'pick', reason: 'out_of_range' }],
    })
  })
})

describe('parseJevResponse on noul and score answers', () => {
  const noul = { yes: { type: 'noul', instructions: 'q' } as NoulQuestion }
  const score = { lvl: { type: 'score', instructions: 'q', criteria: ['x', 'y', 'z'] } as ScoreQuestion }

  test('noul outside [0, 1]', () => {
    expect(parseJevResponse(ok({ answers: { yes: { type: 'noul', noul: 1.5 } } }), noul)).toMatchObject({
      errors: [{ key: 'yes', reason: 'out_of_range' }],
    })
  })

  test('noul value missing', () => {
    expect(parseJevResponse(ok({ answers: { yes: { type: 'noul' } } }), noul)).toMatchObject({
      errors: [{ key: 'yes', reason: 'missing_field' }],
    })
  })

  test('score above the last level', () => {
    expect(parseJevResponse(ok({ answers: { lvl: { type: 'score', score: 2.5 } } }), score)).toMatchObject({
      errors: [{ key: 'lvl', reason: 'out_of_range' }],
    })
  })

  test('score probabilities keyed by level index', () => {
    const answer = { type: 'score', score: 1, probabilities: { '0': 0, '1': 1 } }
    expect(parseJevResponse(ok({ answers: { lvl: answer } }), score)).toMatchObject({
      errors: [{ key: 'lvl', reason: 'probabilities_mismatch' }],
    })
  })
})

describe('parseJevResponse on broken responses', () => {
  test('non-2xx status is not parsed', () => {
    expect(parseJevResponse({ status: 500, text: '<html>' }, pick)).toEqual({ ok: false, fail: 'http_500' })
  })

  test('body is not JSON', () => {
    expect(parseJevResponse({ status: 200, text: '<html>' }, pick)).toEqual({ ok: false, fail: 'malformed' })
  })

  test('no answers object', () => {
    expect(parseJevResponse(ok({ model: 'm' }), pick)).toEqual({ ok: false, fail: 'malformed' })
  })

  test('missing key and answer of another type', () => {
    const questions = { ...pick, other: { type: 'noul', instructions: 'q' } as NoulQuestion }
    const r = parseJevResponse(ok({ answers: { pick: { type: 'noul', noul: 0.5 } } }), questions)
    expect(r).toEqual({
      ok: false,
      fail: 'invalid',
      errors: [
        { key: 'pick', reason: 'wrong_type' },
        { key: 'other', reason: 'wrong_type' },
      ],
    })
  })
})

describe('peek helpers', () => {
  test('peekAnswer and peekModel read the raw body', async () => {
    const text = await fixture('typesafe-noul-score')
    expect(peekAnswer(text, 'measurable')).toEqual({ type: 'noul', noul: 0.08 })
    expect(peekAnswer(text, 'nothing')).toBeUndefined()
    expect(peekModel(text)).toBe('jev-1.13.0')
    expect(peekModel('<html>')).toBeUndefined()
  })
})
