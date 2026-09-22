import { describe, expect, test } from 'bun:test'
import { stepsOf } from '../../cli/extract'
import { codeFindingsOf, findingsOf, questionsFor, stateOf } from '../../cli/verifiers/plan-steps'
import { parseJevResponse } from '../../hooks/core/response'

const fixtures = `${import.meta.dir}/../fixtures`

describe('plan steps on recorded Jev answers', () => {
  const expected: Record<string, [string, string][]> = {
    'steps-heading-Шаг-1': [['observable_check', 'discretion']],
    'steps-heading-Шаг-2': [],
    'steps-heading-Шаг-3': [['observable_check', 'flag']],
    'steps-heading-Шаг-4': [['observable_check', 'flag'], ['manual_action', 'flag']],
    'steps-heading-Шаг-5': [['no_check', 'flag'], ['unverified_behavior', 'flag']],
    'steps-numbered-Шаг-3': [],
    'steps-numbered-Шаг-5': [],
  }
  for (const plan of ['steps-heading', 'steps-numbered']) {
    test(plan, async () => {
      for (const step of stepsOf(await Bun.file(`${fixtures}/plans/${plan}.md`).text())) {
        const name = `${plan}-${step.id.replace(' ', '-')}`
        const f = await Bun.file(`${fixtures}/plan-steps/${name}.json`).json()
        expect(f.state).toEqual(stateOf(step))
        expect(f.questions).toEqual(questionsFor(step))
        const parsed = parseJevResponse({ status: 200, text: JSON.stringify(f.response) }, questionsFor(step))
        if (!parsed.ok) throw new Error(JSON.stringify(parsed))
        const got = [...codeFindingsOf(step), ...findingsOf(step, parsed.answers)].map((x) => [x.signal, x.zone])
        expect({ name, got }).toEqual({ name, got: expected[name]! })
      }
    })
  }
})

describe('plan step rules', () => {
  const step = (check?: string, paths = ['a/b.ts']) => ({
    id: 'Шаг 1', line: 1, text: 't', paths, ...(check === undefined ? {} : { check }),
  })

  test('a step without a check is not asked about the check', () => {
    expect(Object.keys(questionsFor(step()))).toEqual(['manual_action', 'unverified_behavior'])
    expect(Object.keys(questionsFor(step('bun test')))).toContain('observable_check')
    expect(stateOf(step())).toEqual({ step: 't' })
  })

  test('code flags: no check, no paths', () => {
    expect(codeFindingsOf(step(undefined, [])).map((f) => f.signal)).toEqual(['no_check', 'no_paths'])
    expect(codeFindingsOf(step('bun test'))).toEqual([])
  })
})
