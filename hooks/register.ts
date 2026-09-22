import type { EngineInterface, On } from 'claude-code'
import { selectCandidates } from './candidates'
import { classify, type ClassifyHost } from './classify'
import { describeInvalid, loadConfig, type ConfigHost, type ConfigResult, type Provider } from './config'
import { Turns } from './turns'

const turns = new Turns()
let isInvalidLogged = false
const isEnabled = ($: EngineInterface): Promise<boolean> =>
  $.env
    .get('CLAUDE_CODE_ENABLE_FUNCTION_HOOKS')
    .then((v) => v !== undefined && v !== '', () => false)

const logInvalidOnce = ($: EngineInterface, r: Extract<ConfigResult, { ok: false }>) => {
  if (isInvalidLogged) return
  isInvalidLogged = true
  $.ui.log(describeInvalid(r))
}

const logInternal = ($: EngineInterface, provider?: Provider) =>
  $.ui.log(provider === undefined ? 'jev-box: internal' : `jev-box: ${provider} internal`)

const hostOf = ($: EngineInterface): ConfigHost & ClassifyHost => ({
  env: { get: () => $.env.get('HOME') },
  fs: { read: (path) => $.fs.read(path) },
  http: { fetch: (url, init) => $.http.fetch(url, init) },
  clock: { sleep: (ms) => $.clock.sleep(ms) },
  ui: { log: (text) => $.ui.log(text) },
})

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    try {
      if (await isEnabled($)) {
        const r = await loadConfig(hostOf($))
        if (!r.ok) logInvalidOnce($, r)
      }
    } catch {
      logInternal($)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    let provider: Provider | undefined
    try {
      if (e.text !== '' && (await isEnabled($))) {
        const r = await loadConfig(hostOf($))
        if (!r.ok) {
          logInvalidOnce($, r)
        } else {
          provider = r.config.provider
          const usage = await $.session.usage()
          const candidates = selectCandidates(r.config.models, usage.context.tokens, r.config.contextReserve)
          turns.start(e.turnId, classify(hostOf($), r.config, e.text, candidates))
        }
      }
    } catch {
      logInternal($, provider)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    let id: string | undefined
    if (e.agentId === undefined) {
      try {
        id = await turns.resolveStep(e)
      } catch {
        logInternal($)
      }
    }
    return yield* next(id === undefined ? e : { ...e, model: id })
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) turns.complete(e.turnId)
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    let id: string | undefined
    let provider: Provider | undefined
    try {
      if (!e.fork && e.model === undefined && (await isEnabled($))) {
        const r = await loadConfig(hostOf($))
        if (!r.ok) {
          logInvalidOnce($, r)
        } else if (r.config.subagentTypes.includes(e.subagentType)) {
          provider = r.config.provider
          const text = `${e.description}\n\n${e.prompt}`
          id = await classify(hostOf($), r.config, text, r.config.models)
        }
      }
    } catch {
      logInternal($, provider)
    }
    return next(id === undefined ? e : { ...e, model: id })
  })
}
