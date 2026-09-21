import { describe, expect, test } from 'bun:test'
import type { Config } from '../hooks/config'
import { buildRequest, ENDPOINTS, parseResponse, QUESTION } from '../hooks/jev'

const models = [
  { id: 'claude-haiku-4-5', description: 'Trivial requests', contextWindow: 200000 },
  { id: 'claude-sonnet-5', description: 'Routine coding', contextWindow: 1000000 },
  { id: 'claude-opus-5', description: 'Hard engineering', contextWindow: 1000000 },
  { id: 'claude-fable-5-1', description: 'Hardest work', contextWindow: 1000000 },
]

const config = (patch: Partial<Config> = {}): Config => ({
  provider: 'openrouter',
  models,
  subagentTypes: ['general-purpose'],
  timeoutMs: 3000,
  typesafe: { apiKey: 'ts-key', model: 'jev-latest' },
  openrouter: { apiKey: 'or-key', model: '~typesafe/jev-latest' },
  ...patch,
})

const fixture = (name: string) =>
  Bun.file(`${import.meta.dir}/fixtures/${name}.json`).text()

const ok = (body: unknown) => ({ status: 200, text: JSON.stringify(body) })

describe('buildRequest', () => {
  const expectedBody = (model: string) => ({
    model,
    state: 'rename foo',
    questions: {
      model: {
        type: 'choice',
        instructions: QUESTION,
        criteria: {
          'claude-haiku-4-5': 'Trivial requests',
          'claude-opus-5': 'Hard engineering',
        },
      },
    },
  })
  const candidates = [models[0]!, models[2]!]

  test('openrouter: Decisions API, openrouter key and model', () => {
    const req = buildRequest(config(), 'rename foo', candidates)
    expect(req.url).toBe('https://openrouter.ai/api/alpha/decisions')
    expect(req.init.method).toBe('POST')
    expect(req.init.headers).toEqual({
      Authorization: 'Bearer or-key',
      'Content-Type': 'application/json',
    })
    expect(JSON.parse(req.init.body)).toEqual(expectedBody('~typesafe/jev-latest'))
  })

  test('typesafe: systemone endpoint, typesafe key and model', () => {
    const req = buildRequest(config({ provider: 'typesafe' }), 'rename foo', candidates)
    expect(req.url).toBe(ENDPOINTS.typesafe)
    expect(req.init.headers.Authorization).toBe('Bearer ts-key')
    expect(JSON.parse(req.init.body)).toEqual(expectedBody('jev-latest'))
  })

  test('criteria hold the candidates only', () => {
    const req = buildRequest(config(), 'x', [models[1]!])
    expect(Object.keys(JSON.parse(req.init.body).questions.model.criteria)).toEqual([
      'claude-sonnet-5',
    ])
  })
})

describe('parseResponse on recorded answers', () => {
  const cases: [string, string][] = [
    ['openrouter-simple', 'claude-haiku-4-5'],
    ['openrouter-complex', 'claude-opus-5'],
    ['typesafe-simple', 'claude-haiku-4-5'],
    ['typesafe-complex', 'claude-opus-5'],
  ]
  for (const [name, id] of cases) {
    test(name, async () => {
      const res = { status: 200, text: await fixture(name) }
      expect(parseResponse(res, config(), models)).toEqual({ id })
    })
  }

  test('openrouter-complex under a 0.9 threshold is low confidence', async () => {
    const res = { status: 200, text: await fixture('openrouter-complex') }
    expect(parseResponse(res, config({ minConfidence: 0.9 }), models)).toEqual({
      none: 'low_confidence',
    })
  })
})

describe('parseResponse failures', () => {
  const answer = (a: Record<string, unknown>) => ok({ answers: { model: { type: 'choice', ...a } } })

  test('non-2xx status', () => {
    expect(parseResponse({ status: 402, text: '{}' }, config(), models)).toEqual({
      fail: 'http_402',
    })
  })

  test('body is not JSON', () => {
    expect(parseResponse({ status: 200, text: '<html>' }, config(), models)).toEqual({
      fail: 'bad_response',
    })
  })

  test('no answers.model', () => {
    expect(parseResponse(ok({ answers: {} }), config(), models)).toEqual({
      fail: 'bad_response',
    })
  })

  test('choice is not a string', () => {
    expect(parseResponse(answer({ choice: 3 }), config(), models)).toEqual({
      fail: 'bad_response',
    })
  })

  test('choice outside the candidates', () => {
    expect(parseResponse(answer({ choice: 'gpt-5' }), config(), [models[0]!])).toEqual({
      fail: 'unknown_model',
    })
  })

  test('threshold set but confidence missing, as OpenRouter may answer', () => {
    const res = answer({ choice: 'claude-opus-5' })
    expect(parseResponse(res, config({ minConfidence: 0.5 }), models)).toEqual({
      none: 'low_confidence',
    })
  })

  test('no threshold: confidence is not required', () => {
    expect(parseResponse(answer({ choice: 'claude-opus-5' }), config(), models)).toEqual({
      id: 'claude-opus-5',
    })
  })

  test('confidence equal to the threshold passes', () => {
    const res = answer({ choice: 'claude-opus-5', confidence: 0.85 })
    expect(parseResponse(res, config({ minConfidence: 0.85 }), models)).toEqual({
      id: 'claude-opus-5',
    })
  })
})
