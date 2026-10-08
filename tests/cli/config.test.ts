import { describe, expect, test } from 'bun:test'
import { validateConfig } from '../../cli/config'

const valid = {
  provider: 'typesafe',
  typesafe: { apiKey: 'k' },
}

describe('validateConfig', () => {
  test('defaults fill the optional fields, old hook fields are ignored', () => {
    const r = validateConfig({ ...valid, models: [], subagentTypes: 'x' })
    expect(r).toEqual({
      ok: true,
      config: {
        provider: 'typesafe',
        timeoutMs: 3000,
        typesafe: { apiKey: 'k', model: 'jev-latest' },
        openrouter: { model: '~typesafe/jev-latest' },
      },
    })
  })

  test.each([
    [[], 1, 'config.json'],
    [{ ...valid, provider: 'anthropic' }, 2, 'provider'],
    [{ ...valid, timeoutMs: 9001 }, 3, 'timeoutMs'],
    [{ provider: 'openrouter', typesafe: { apiKey: 'k' } }, 4, 'openrouter.apiKey'],
    [{ ...valid, typesafe: { apiKey: 'k', model: '' } }, 5, 'typesafe.model'],
    [{ ...valid, openrouter: { model: 1 } }, 6, 'openrouter.model'],
  ])('%j fails rule %d at %s', (raw, rule, field) => {
    expect(validateConfig(raw)).toEqual({ ok: false, rule, field })
  })
})
