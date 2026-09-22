import { describe, expect, test } from 'bun:test'
import type { On } from 'claude-code'
import { register } from '../hooks/register'

type Hook = (...args: any[]) => any

const hooksOf = () => {
  const hooks: Record<string, Hook> = {}
  register(((event: string, hook: Hook) => {
    hooks[event] = hook
  }) as unknown as On)
  return hooks
}

const configText = JSON.stringify({
  provider: 'openrouter',
  models: [
    { id: 'claude-haiku-4-5', description: 'Trivial', contextWindow: 200000 },
    { id: 'claude-opus-5', description: 'Hard', contextWindow: 1000000 },
  ],
  openrouter: { apiKey: 'k' },
})

const engine = (
  opts: {
    flag?: string
    choice?: string
    tokens?: number
    config?: string
    usageFails?: boolean
    fetchHangs?: boolean
  } = {},
) => {
  const calls: string[] = []
  const logs: string[] = []
  const env: Record<string, string | undefined> = {
    CLAUDE_CODE_ENABLE_FUNCTION_HOOKS: opts.flag ?? '1',
    HOME: '/home/u',
  }
  const $ = {
    env: { get: async (name: string) => env[name] },
    fs: {
      read: async (path: string) => {
        calls.push(`fs.read ${path}`)
        return opts.config ?? configText
      },
    },
    http: {
      fetch: async (url: string) => {
        calls.push(`http.fetch ${url}`)
        if (opts.fetchHangs) return new Promise(() => {})
        return {
          status: 200,
          text: JSON.stringify({ answers: { model: { choice: opts.choice ?? 'claude-haiku-4-5' } } }),
        }
      },
    },
    clock: { sleep: () => new Promise(() => {}) },
    session: {
      usage: async () => {
        if (opts.usageFails) throw new Error('usage unavailable')
        return { context: { tokens: opts.tokens, window: 1000000 } }
      },
    },
    ui: { log: (text: string) => logs.push(text) },
  }
  return { $, calls, logs }
}

const live = new AbortController().signal

const runStep = async (
  hook: Hook,
  $: unknown,
  e: Record<string, unknown>,
  signal: AbortSignal = live,
) => {
  const seen: Record<string, unknown>[] = []
  async function* next(arg: Record<string, unknown>) {
    seen.push(arg)
    return { done: true }
  }
  const gen = hook($, e, Object.assign(next, { signal }))
  for await (const _ of gen) {
  }
  return seen[0]
}

const nextOf = (signal: AbortSignal = live) => {
  const seen: unknown[] = []
  const next = Object.assign(async (e: unknown) => (seen.push(e), e), { signal })
  return { next, seen }
}

const passthrough = nextOf().next

describe('register', () => {
  test('without CLAUDE_CODE_ENABLE_FUNCTION_HOOKS nothing is read or sent', async () => {
    const hooks = hooksOf()
    const { $, calls, logs } = engine({ flag: '' })
    await hooks['session.start']!($, {}, passthrough)
    await hooks['turn.start']!($, { text: 'rename foo', turnId: 't1' }, passthrough)
    const spawn = { fork: false, subagentType: 'general-purpose', description: 'd', prompt: 'p' }
    expect(await hooks['agent.spawn']!($, spawn, passthrough)).toEqual(spawn)
    const step = { turnId: 't1', index: 0, model: 'claude-opus-5', messageCount: 1 }
    expect(await runStep(hooks['turn.step']!, $, step)).toEqual(step)
    expect(calls).toEqual([])
    expect(logs).toEqual([])
  })

  test('a turn runs on the model Jev picked', async () => {
    const hooks = hooksOf()
    const { $, calls } = engine({ choice: 'claude-haiku-4-5' })
    await hooks['turn.start']!($, { text: 'rename foo', turnId: 't1' }, passthrough)
    const step = { turnId: 't1', index: 0, model: 'claude-opus-5', effort: 'high', messageCount: 1 }
    expect(await runStep(hooks['turn.step']!, $, step)).toEqual({ ...step, model: 'claude-haiku-4-5' })
    expect(calls).toEqual([
      'fs.read /home/u/.config/jev-box/config.json',
      'http.fetch https://openrouter.ai/api/alpha/decisions',
    ])
    await hooks['turn.complete']!($, { turnId: 't1', reason: 'answer' }, passthrough)
  })

  test('a subagent step is never switched', async () => {
    const hooks = hooksOf()
    const { $ } = engine()
    await hooks['turn.start']!($, { text: 'x', turnId: 't2' }, passthrough)
    const step = { turnId: 't2', index: 0, model: 'claude-opus-5', agentId: 'a1', messageCount: 1 }
    expect(await runStep(hooks['turn.step']!, $, step)).toEqual(step)
  })

  test('models with a window below the context are not offered to Jev', async () => {
    const hooks = hooksOf()
    const { $ } = engine({ choice: 'claude-haiku-4-5', tokens: 300000 })
    await hooks['turn.start']!($, { text: 'x', turnId: 't3' }, passthrough)
    const step = { turnId: 't3', index: 0, model: 'claude-opus-5', messageCount: 1 }
    expect(await runStep(hooks['turn.step']!, $, step)).toEqual(step)
  })

  test('an empty prompt is not classified', async () => {
    const hooks = hooksOf()
    const { $, calls } = engine()
    await hooks['turn.start']!($, { text: '', turnId: 't4' }, passthrough)
    expect(calls).toEqual([])
  })

  describe('agent.spawn', () => {
    const spawn = (patch: Record<string, unknown> = {}) => ({
      fork: false,
      subagentType: 'general-purpose',
      description: 'Rename',
      prompt: 'Rename foo to bar',
      ...patch,
    })

    test('a listed type gets the model Jev picked', async () => {
      const { $ } = engine({ choice: 'claude-haiku-4-5' })
      expect(await hooksOf()['agent.spawn']!($, spawn(), passthrough)).toEqual({
        ...spawn(),
        model: 'claude-haiku-4-5',
      })
    })

    const untouched: [string, Record<string, unknown>][] = [
      ['a fork', { fork: true }],
      ['an explicit model', { model: 'claude-sonnet-5' }],
      ['a type not in subagentTypes', { subagentType: 'Explore' }],
    ]
    for (const [name, patch] of untouched) {
      test(`${name} is left alone without a request`, async () => {
        const { $, calls } = engine()
        expect(await hooksOf()['agent.spawn']!($, spawn(patch), passthrough)).toEqual(spawn(patch))
        expect(calls.filter((c) => c.startsWith('http'))).toEqual([])
      })
    }
  })

  test('a failing host call after the config is read logs the provider and passes through once', async () => {
    const hooks = hooksOf()
    const { $, calls, logs } = engine({ usageFails: true })
    const nexts: unknown[] = []
    const e = { text: 'x', turnId: 't6' }
    await hooks['turn.start']!($, e, async (arg: unknown) => nexts.push(arg))
    expect(nexts).toEqual([e])
    expect(logs).toEqual(['jev-box: openrouter internal'])
    expect(calls.filter((c) => c.startsWith('http'))).toEqual([])
    const step = { turnId: 't6', index: 0, model: 'claude-opus-5', messageCount: 1 }
    expect(await runStep(hooks['turn.step']!, $, step)).toEqual(step)
  })

  test('the reserve from the config decides which models Jev may pick', async () => {
    const withReserve = (contextReserve?: number) =>
      JSON.stringify({ ...JSON.parse(configText), ...(contextReserve ? { contextReserve } : {}) })
    const step = { turnId: 'r', index: 0, model: 'claude-opus-5', messageCount: 1 }

    const tight = engine({ choice: 'claude-haiku-4-5', tokens: 150000, config: withReserve() })
    const h1 = hooksOf()
    await h1['turn.start']!(tight.$, { text: 'x', turnId: 'r' }, passthrough)
    expect(await runStep(h1['turn.step']!, tight.$, step)).toEqual(step)
    await h1['turn.complete']!(tight.$, { turnId: 'r', reason: 'answer' }, passthrough)

    const loose = engine({ choice: 'claude-haiku-4-5', tokens: 150000, config: withReserve(1) })
    const h2 = hooksOf()
    await h2['turn.start']!(loose.$, { text: 'x', turnId: 'r' }, passthrough)
    expect(await runStep(h2['turn.step']!, loose.$, step)).toEqual({ ...step, model: 'claude-haiku-4-5' })
    await h2['turn.complete']!(loose.$, { turnId: 'r', reason: 'answer' }, passthrough)
  })

  test('turn.complete forgets the turn', async () => {
    const hooks = hooksOf()
    const { $ } = engine({ choice: 'claude-haiku-4-5' })
    await hooks['turn.start']!($, { text: 'x', turnId: 'c1' }, passthrough)
    await hooks['turn.complete']!($, { turnId: 'c1', reason: 'answer' }, passthrough)
    const step = { turnId: 'c1', index: 0, model: 'claude-opus-5', messageCount: 1 }
    expect(await runStep(hooks['turn.step']!, $, step)).toEqual(step)
  })

  test('an aborted step stops waiting and never calls next', async () => {
    const hooks = hooksOf()
    const { $ } = engine({ fetchHangs: true })
    await hooks['turn.start']!($, { text: 'x', turnId: 'a1' }, passthrough)
    const controller = new AbortController()
    const step = { turnId: 'a1', index: 0, model: 'claude-opus-5', messageCount: 1 }
    const pending = runStep(hooks['turn.step']!, $, step, controller.signal)
    controller.abort()
    expect(await pending).toBeUndefined()
    await hooks['turn.complete']!($, { turnId: 'a1', reason: 'aborted' }, passthrough)
  })

  test('an aborted spawn stops waiting and starts no subagent', async () => {
    const { $ } = engine({ fetchHangs: true })
    const controller = new AbortController()
    const { next, seen } = nextOf(controller.signal)
    const spawn = { fork: false, subagentType: 'general-purpose', description: 'd', prompt: 'p' }
    const pending = hooksOf()['agent.spawn']!($, spawn, next)
    controller.abort()
    expect(await pending).toEqual({ deny: 'jev-box: spawn aborted' })
    expect(seen).toEqual([])
  })

  test('an invalid config passes through and logs once', async () => {
    const hooks = hooksOf()
    const { $, calls, logs } = engine({ config: '{ broken' })
    await hooks['session.start']!($, {}, passthrough)
    await hooks['turn.start']!($, { text: 'x', turnId: 't5' }, passthrough)
    expect(calls.filter((c) => c.startsWith('http'))).toEqual([])
    expect(logs).toEqual(['jev-box: config ignored, rule 1 failed at .config/jev-box/config.json'])
  })

  test('after session.end a new session reports the invalid config again', async () => {
    const hooks = hooksOf()
    const { $, logs } = engine({ config: '{ broken' })
    await hooks['session.end']!($, { reason: 'clear' }, passthrough)
    await hooks['turn.start']!($, { text: 'x', turnId: 's1' }, passthrough)
    await hooks['turn.start']!($, { text: 'y', turnId: 's2' }, passthrough)
    await hooks['session.end']!($, { reason: 'clear' }, passthrough)
    await hooks['turn.start']!($, { text: 'z', turnId: 's3' }, passthrough)
    const line = 'jev-box: config ignored, rule 1 failed at .config/jev-box/config.json'
    expect(logs).toEqual([line, line])
  })
})
