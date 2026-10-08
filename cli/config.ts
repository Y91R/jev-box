export type Provider = 'typesafe' | 'openrouter'

export type ProviderSection = {
  apiKey?: string
  model: string
}

export type Config = {
  provider: Provider
  timeoutMs: number
  typesafe: ProviderSection
  openrouter: ProviderSection
}

export type ConfigResult =
  | { ok: true; config: Config }
  | { ok: false; rule: number; field: string }

export type ConfigHost = {
  env: { get: (name: 'HOME') => Promise<string | undefined> }
  fs: { read: (path: string) => Promise<string> }
}

export const CONFIG_SUBPATH = '.config/jev-box/config.json'
const MAX_TIMEOUT_MS = 9000

const DEFAULTS = {
  timeoutMs: 3000,
  typesafeModel: 'jev-latest',
  openrouterModel: '~typesafe/jev-latest',
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0

const isPositiveInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0

const invalid = (rule: number, field: string): ConfigResult => ({
  ok: false,
  rule,
  field,
})

const sectionOf = (raw: Json, name: Provider): Json =>
  isObject(raw[name]) ? raw[name] : {}

export function validateConfig(raw: unknown): ConfigResult {
  if (!isObject(raw)) return invalid(1, 'config.json')

  const provider = raw.provider
  if (provider !== 'typesafe' && provider !== 'openrouter') {
    return invalid(2, 'provider')
  }

  const timeoutMs = raw.timeoutMs ?? DEFAULTS.timeoutMs
  if (!isPositiveInt(timeoutMs) || timeoutMs > MAX_TIMEOUT_MS) {
    return invalid(3, 'timeoutMs')
  }

  const typesafe = sectionOf(raw, 'typesafe')
  const openrouter = sectionOf(raw, 'openrouter')
  const active = provider === 'typesafe' ? typesafe : openrouter
  if (!isNonEmptyString(active.apiKey)) return invalid(4, `${provider}.apiKey`)

  const typesafeModel = typesafe.model ?? DEFAULTS.typesafeModel
  if (!isNonEmptyString(typesafeModel)) return invalid(5, 'typesafe.model')

  const openrouterModel = openrouter.model ?? DEFAULTS.openrouterModel
  if (!isNonEmptyString(openrouterModel)) return invalid(6, 'openrouter.model')

  return {
    ok: true,
    config: {
      provider,
      timeoutMs,
      typesafe: {
        model: typesafeModel,
        ...(isNonEmptyString(typesafe.apiKey) ? { apiKey: typesafe.apiKey } : {}),
      },
      openrouter: {
        model: openrouterModel,
        ...(isNonEmptyString(openrouter.apiKey)
          ? { apiKey: openrouter.apiKey }
          : {}),
      },
    },
  }
}

export async function loadConfig($: ConfigHost): Promise<ConfigResult> {
  const home = await $.env.get('HOME').catch(() => undefined)
  if (!home) return invalid(1, 'HOME')
  let text: string
  try {
    text = await $.fs.read(`${home}/${CONFIG_SUBPATH}`)
  } catch {
    return invalid(1, CONFIG_SUBPATH)
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return invalid(1, CONFIG_SUBPATH)
  }
  return validateConfig(raw)
}
