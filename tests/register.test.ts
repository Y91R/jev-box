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

const engine = (opts: { flag?: string; choice?: string; tokens?: number; config?: string } = {}) => {
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
        return {
          status: 200,
          text: JSON.stringify({ answers: { model: { choice: opts.choice ?? 'claude-haiku-4-5' } } }),
        }
      },
    },
    clock: { sleep: () => new Promise(() => {}) },
    session: { usage: async () => ({ context: { tokens: opts.tokens, window: 1000000 } }) },
    ui: { log: (text: string) => logs.push(text) },
  }
  return { $, calls, logs }
}

const runStep = async (hook: Hook, $: unknown, e: Record<string, unknown>) => {
  const seen: Record<string, unknown>[] = []
  async function* next(arg: Record<string, unknown>) {
    seen.push(arg)
    return { done: true }
  }
  const gen = hook($, e, next)
  for await (const _ of gen) {
  }
  return seen[0]
}

const passthrough = async (e: unknown) => e

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

  test('an invalid config passes through and logs once', async () => {
    const hooks = hooksOf()
    const { $, calls, logs } = engine({ config: '{ broken' })
    await hooks['session.start']!($, {}, passthrough)
    await hooks['turn.start']!($, { text: 'x', turnId: 't5' }, passthrough)
    expect(calls.filter((c) => c.startsWith('http'))).toEqual([])
    expect(logs).toEqual(['jev-box: config ignored, rule 1 failed at .config/jev-box/config.json'])
  })
})
