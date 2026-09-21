import { describe, expect, test } from 'bun:test'
import { classify, type ClassifyHost } from '../hooks/classify'
import type { Config } from '../hooks/config'

const models = [
  { id: 'claude-haiku-4-5', description: 'Trivial requests', contextWindow: 200000 },
  { id: 'claude-opus-5', description: 'Hard engineering', contextWindow: 1000000 },
]

const config = (patch: Partial<Config> = {}): Config => ({
  provider: 'openrouter',
  models,
  subagentTypes: ['general-purpose'],
  timeoutMs: 3000,
  typesafe: { model: 'jev-latest' },
  openrouter: { apiKey: 'secret-or-key', model: '~typesafe/jev-latest' },
  ...patch,
})

const choice = (id: string, confidence = 0.99) =>
  JSON.stringify({ answers: { model: { type: 'choice', choice: id, confidence } } })

type Reply = { status: number; text: string } | 'reject' | 'hang'

const host = (reply: Reply, opts: { sleepResolves?: boolean } = {}) => {
  const logs: string[] = []
  const calls: { url: string; body: string }[] = []
  const $: ClassifyHost = {
    http: {
      fetch: (url, init) => {
        calls.push({ url, body: init.body })
        if (reply === 'reject') return Promise.reject(new Error('ECONNREFUSED'))
        if (reply === 'hang') return new Promise(() => {})
        return Promise.resolve(reply)
      },
    },
    clock: {
      sleep: () => (opts.sleepResolves ? Promise.resolve() : new Promise(() => {})),
    },
    ui: { log: (text) => logs.push(text) },
  }
  return { $, logs, calls }
}

describe('classify', () => {
  test('returns the chosen id without logging', async () => {
    const { $, logs, calls } = host({ status: 200, text: choice('claude-opus-5') })
    expect(await classify($, config(), 'redesign storage', models)).toBe('claude-opus-5')
    expect(logs).toEqual([])
    expect(calls.map((c) => c.url)).toEqual(['https://openrouter.ai/api/alpha/decisions'])
  })

  test('no candidates: no request, no log', async () => {
    const { $, logs, calls } = host({ status: 200, text: choice('claude-opus-5') })
    expect(await classify($, config(), 'x', [])).toBeUndefined()
    expect(calls).toEqual([])
    expect(logs).toEqual([])
  })

  test('low confidence: no decision, no log', async () => {
    const { $, logs } = host({ status: 200, text: choice('claude-opus-5', 0.4) })
    expect(await classify($, config({ minConfidence: 0.5 }), 'x', models)).toBeUndefined()
    expect(logs).toEqual([])
  })

  const failures: [string, Reply, string][] = [
    ['timeout', 'hang', 'jev-box: openrouter timeout'],
    ['network', 'reject', 'jev-box: openrouter network'],
    ['http status', { status: 429, text: '{}' }, 'jev-box: openrouter http_429'],
    ['bad body', { status: 200, text: 'oops' }, 'jev-box: openrouter bad_response'],
    [
      'unknown model',
      { status: 200, text: choice('claude-sonnet-5') },
      'jev-box: openrouter unknown_model',
    ],
  ]
  for (const [name, reply, line] of failures) {
    test(`${name}: no decision, one log line`, async () => {
      const { $, logs } = host(reply, { sleepResolves: reply === 'hang' })
      expect(await classify($, config(), 'x', models)).toBeUndefined()
      expect(logs).toEqual([line])
    })
  }

  test('a reply that loses the race to the timer is ignored', async () => {
    const { $, logs } = host({ status: 200, text: choice('claude-opus-5') }, { sleepResolves: true })
    const late: ClassifyHost = {
      ...$,
      http: { fetch: () => new Promise((r) => setTimeout(() => r({ status: 200, text: choice('claude-opus-5') }), 5)) },
    }
    expect(await classify(late, config(), 'x', models)).toBeUndefined()
    expect(logs).toEqual(['jev-box: openrouter timeout'])
  })

  test('an exception inside is internal, never thrown', async () => {
    const { logs } = host('hang')
    const broken: ClassifyHost = {
      http: {
        fetch: () => {
          throw new Error('boom')
        },
      },
      clock: { sleep: () => new Promise(() => {}) },
      ui: { log: (t) => logs.push(t) },
    }
    expect(await classify(broken, config(), 'x', models)).toBeUndefined()
    expect(logs).toEqual(['jev-box: openrouter internal'])
  })

  test('the api key never reaches the log', async () => {
    const { $, logs } = host({ status: 401, text: '{"error":"bad key secret-or-key"}' })
    await classify($, config(), 'x', models)
    expect(logs.join('\n')).not.toContain('secret-or-key')
  })

  test('typesafe provider is named in the log', async () => {
    const { $, logs } = host({ status: 529, text: '{}' })
    const ts = config({ provider: 'typesafe', typesafe: { apiKey: 'k', model: 'jev-latest' } })
    await classify($, ts, 'x', models)
    expect(logs).toEqual(['jev-box: typesafe http_529'])
  })
})
