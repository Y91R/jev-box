import { describe, expect, test } from 'bun:test'
import {
  CONFIG_SUBPATH,
  describeInvalid,
  loadConfig,
  validateConfig,
  type ConfigHost,
} from '../hooks/config'

const model = (id: string, contextWindow = 200000) => ({
  id,
  description: `use ${id}`,
  contextWindow,
})

const minimal = () => ({
  provider: 'openrouter',
  models: [model('claude-haiku-4-5'), model('claude-opus-5', 1000000)],
  openrouter: { apiKey: 'or-key' },
})

const withField = (patch: Record<string, unknown>) => ({ ...minimal(), ...patch })

const failure = (raw: unknown) => {
  const r = validateConfig(raw)
  if (r.ok) throw new Error('expected invalid config')
  return { rule: r.rule, field: r.field }
}

describe('validateConfig', () => {
  test('fills defaults for a minimal config', () => {
    const r = validateConfig(minimal())
    if (!r.ok) throw new Error(`unexpected rule ${r.rule}`)
    expect(r.config).toEqual({
      provider: 'openrouter',
      models: [model('claude-haiku-4-5'), model('claude-opus-5', 1000000)],
      subagentTypes: ['general-purpose'],
      timeoutMs: 3000,
      contextReserve: 0.5,
      logLevel: 'off',
      typesafe: { model: 'jev-latest' },
      openrouter: { model: '~typesafe/jev-latest', apiKey: 'or-key' },
    })
  })

  test('keeps explicit optional values', () => {
    const r = validateConfig(
      withField({
        timeoutMs: 9000,
        contextReserve: 1,
        logLevel: 'debug',
        subagentTypes: ['general-purpose', 'Plan'],
        minConfidence: 0.7,
        typesafe: { apiKey: 'ts-key', model: 'jev-1.13' },
        openrouter: { apiKey: 'or-key', model: 'typesafe/jev-1.13' },
      }),
    )
    if (!r.ok) throw new Error(`unexpected rule ${r.rule}`)
    expect(r.config.timeoutMs).toBe(9000)
    expect(r.config.contextReserve).toBe(1)
    expect(r.config.logLevel).toBe('debug')
    expect(r.config.subagentTypes).toEqual(['general-purpose', 'Plan'])
    expect(r.config.minConfidence).toBe(0.7)
    expect(r.config.typesafe).toEqual({ apiKey: 'ts-key', model: 'jev-1.13' })
    expect(r.config.openrouter.model).toBe('typesafe/jev-1.13')
  })

  test('only the active provider needs a key', () => {
    expect(validateConfig({ ...minimal(), typesafe: {} }).ok).toBe(true)
    expect(failure({ ...minimal(), provider: 'typesafe' })).toEqual({
      rule: 10,
      field: 'typesafe.apiKey',
    })
  })

  const cases: [string, unknown, number, string][] = [
    ['1: not an object', [], 1, 'config.json'],
    ['2: unknown provider', withField({ provider: 'anthropic' }), 2, 'provider'],
    ['3: models missing', withField({ models: undefined }), 3, 'models'],
    ['3: models empty', withField({ models: [] }), 3, 'models'],
    ['3: model not an object', withField({ models: ['x'] }), 3, 'models[0]'],
    ['4: empty id', withField({ models: [{ ...model('a'), id: '' }] }), 4, 'models[0].id'],
    [
      '4: missing description',
      withField({ models: [{ id: 'a', contextWindow: 1 }] }),
      4,
      'models[0].description',
    ],
    ['5: duplicate id', withField({ models: [model('a'), model('a')] }), 5, 'models[1].id'],
    [
      '6: fractional contextWindow',
      withField({ models: [model('a', 1.5)] }),
      6,
      'models[0].contextWindow',
    ],
    [
      '7: more than 255 models',
      withField({ models: Array.from({ length: 256 }, (_, i) => model(`m${i}`)) }),
      7,
      'models',
    ],
    ['8: timeout over 9000', withField({ timeoutMs: 9001 }), 8, 'timeoutMs'],
    ['8: timeout zero', withField({ timeoutMs: 0 }), 8, 'timeoutMs'],
    ['9: subagentTypes with empty string', withField({ subagentTypes: [''] }), 9, 'subagentTypes'],
    ['10: empty active key', withField({ openrouter: { apiKey: '' } }), 10, 'openrouter.apiKey'],
    [
      '11: typesafe.model not a string',
      withField({ typesafe: { model: 5 } }),
      11,
      'typesafe.model',
    ],
    ['12: minConfidence above 1', withField({ minConfidence: 1.2 }), 12, 'minConfidence'],
    [
      '13: empty openrouter.model',
      withField({ openrouter: { apiKey: 'k', model: '' } }),
      13,
      'openrouter.model',
    ],
    ['14: contextReserve zero', withField({ contextReserve: 0 }), 14, 'contextReserve'],
    ['14: contextReserve above 1', withField({ contextReserve: 1.5 }), 14, 'contextReserve'],
    ['14: contextReserve not a number', withField({ contextReserve: '0.5' }), 14, 'contextReserve'],
    ['15: unknown logLevel', withField({ logLevel: 'info' }), 15, 'logLevel'],
    ['15: logLevel not a string', withField({ logLevel: true }), 15, 'logLevel'],
  ]
  for (const [name, raw, rule, field] of cases) {
    test(`rule ${name}`, () => expect(failure(raw)).toEqual({ rule, field }))
  }

  test('reports the first failing rule', () => {
    expect(failure(withField({ provider: 'x', timeoutMs: -1 })).rule).toBe(2)
  })
})

const host = (files: Record<string, string>, home: string | null = '/home/u') => {
  const reads: string[] = []
  const $: ConfigHost = {
    env: { get: async () => home ?? undefined },
    fs: {
      read: async (path) => {
        reads.push(path)
        const text = files[path]
        if (text === undefined) throw new Error('ENOENT')
        return text
      },
    },
  }
  return { $, reads }
}

describe('loadConfig', () => {
  const path = `/home/u/${CONFIG_SUBPATH}`

  test('reads the file under HOME', async () => {
    const { $, reads } = host({ [path]: JSON.stringify(minimal()) })
    expect((await loadConfig($)).ok).toBe(true)
    expect(reads).toEqual([path])
  })

  test('HOME unset', async () => {
    const { $ } = host({}, null)
    expect(await loadConfig($)).toEqual({ ok: false, rule: 1, field: 'HOME' })
  })

  test('missing file', async () => {
    const { $ } = host({})
    expect(await loadConfig($)).toEqual({ ok: false, rule: 1, field: CONFIG_SUBPATH })
  })

  test('broken JSON', async () => {
    const { $ } = host({ [path]: '{ nope' })
    expect(await loadConfig($)).toEqual({ ok: false, rule: 1, field: CONFIG_SUBPATH })
  })
})

test('describeInvalid names the rule and field, never values', () => {
  const r = failure(withField({ openrouter: { apiKey: '' } }))
  expect(describeInvalid(r)).toBe(
    'jev-box: config ignored, rule 10 failed at openrouter.apiKey',
  )
})
