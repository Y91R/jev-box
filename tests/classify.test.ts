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
  contextReserve: 0.5,
  logLevel: 'off',
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

  describe('trace', () => {
    const traced = (reply: Reply, opts: { sleepResolves?: boolean } = {}) => {
      const { $, logs } = host(reply, opts)
      const events: [string, Record<string, unknown>][] = []
      const withTrace: ClassifyHost = { ...$, trace: (event, data) => events.push([event, data]) }
      return { $: withTrace, logs, events }
    }

    test('success: request, response and decision', async () => {
      const { $, events } = traced({ status: 200, text: choice('claude-opus-5', 0.87) })
      await classify($, config(), 'redesign storage', models)
      expect(events.map(([e]) => e)).toEqual(['jev_request', 'jev_response', 'decision'])
      expect(events[0]![1]).toEqual({
        provider: 'openrouter',
        url: 'https://openrouter.ai/api/alpha/decisions',
        jevModel: '~typesafe/jev-latest',
        candidates: ['claude-haiku-4-5', 'claude-opus-5'],
        timeoutMs: 3000,
      })
      expect(events[1]![1]).toMatchObject({ status: 200, choice: 'claude-opus-5', confidence: 0.87 })
      expect(typeof events[1]![1].ms).toBe('number')
      expect(events[2]![1]).toEqual({ id: 'claude-opus-5' })
    })

    test('response event names the Jev version that answered', async () => {
      const text = await Bun.file(`${import.meta.dir}/fixtures/typesafe-complex.json`).text()
      const { $, events } = traced({ status: 200, text })
      await classify($, config({ provider: 'typesafe' }), 'x', models)
      expect(events[1]![1]).toMatchObject({ model: 'jev-1.13.0', choice: 'claude-opus-5' })
    })

    test('timeout: failure event and no decision id', async () => {
      const { $, events } = traced('hang', { sleepResolves: true })
      await classify($, config(), 'x', models)
      expect(events.map(([e]) => e)).toEqual(['jev_request', 'jev_failure', 'decision'])
      expect(events[1]![1]).toMatchObject({ provider: 'openrouter', code: 'timeout' })
      expect(events[2]![1]).toEqual({ none: 'timeout' })
    })

    test('http error: response event carries the status', async () => {
      const { $, events } = traced({ status: 402, text: '{}' })
      await classify($, config(), 'x', models)
      expect(events[1]![1]).toMatchObject({ status: 402 })
      expect(events[2]![1]).toEqual({ none: 'http_402' })
    })

    test('no candidates: only the decision', async () => {
      const { $, events } = traced({ status: 200, text: choice('claude-opus-5') })
      await classify($, config(), 'x', [])
      expect(events).toEqual([['decision', { none: 'no_candidates' }]])
    })

    test('the api key appears in no event', async () => {
      const { $, events } = traced({ status: 401, text: '{"error":"bad key secret-or-key"}' })
      await classify($, config(), 'x', models)
      expect(JSON.stringify(events)).not.toContain('secret-or-key')
    })
  })
})
