import type { EngineInterface, On } from 'claude-code'
import { selectCandidates } from './candidates'
import { classify, type ClassifyHost, type Trace } from './classify'
import {
  describeBootstrap,
  describeInvalid,
  ensureConfig,
  loadConfig,
  type BootstrapHost,
  type Config,
  type ConfigHost,
  type ConfigResult,
  type Provider,
} from './config'
import { DebugLog, LOGS_SUBDIR, redact, type DebugLogHost } from './debuglog'
import { Turns } from './turns'

const turns = new Turns()
let isInvalidLogged = false
let sessionLog: DebugLog | undefined
let activeLog: DebugLog | undefined

const isEnabled = ($: EngineInterface): Promise<boolean> =>
  $.env
    .get('CLAUDE_CODE_ENABLE_FUNCTION_HOOKS')
    .then((v) => v !== undefined && v !== '', () => false)

const logInvalidOnce = ($: EngineInterface, r: Extract<ConfigResult, { ok: false }>) => {
  activeLog?.add('config_invalid', { rule: r.rule, field: r.field })
  if (isInvalidLogged) return
  isInvalidLogged = true
  $.ui.log(describeInvalid(r))
}

const ABORTED = { aborted: true } as const

const isAborted = (v: unknown): v is typeof ABORTED => v === ABORTED

const abortOf = (signal: AbortSignal): Promise<typeof ABORTED> =>
  new Promise((resolve) => {
    if (signal.aborted) return resolve(ABORTED)
    signal.addEventListener('abort', () => resolve(ABORTED), { once: true })
  })

const logInternal = ($: EngineInterface, provider?: Provider) => {
  activeLog?.add('internal', { provider })
  $.ui.log(provider === undefined ? 'jev-box: internal' : `jev-box: ${provider} internal`)
}

const hostOf = (
  $: EngineInterface,
  trace?: Trace,
): ConfigHost & ClassifyHost & DebugLogHost & BootstrapHost => ({
  env: { get: () => $.env.get('HOME') },
  fs: {
    read: (path) => $.fs.read(path),
    write: (path, text) => $.fs.write(path, text),
    exists: (path) => $.fs.exists(path),
  },
  process: { run: (argv) => $.process.run(argv) },
  plugin: { root: $.plugin.root },
  http: { fetch: (url, init) => $.http.fetch(url, init) },
  clock: { sleep: (ms) => $.clock.sleep(ms) },
  ui: { log: (text) => $.ui.log(text) },
  ...(trace === undefined ? {} : { trace }),
})

const logFor = async ($: EngineInterface, config: Config): Promise<DebugLog | undefined> => {
  if (config.logLevel !== 'debug') {
    activeLog = undefined
    return undefined
  }
  if (sessionLog === undefined) {
    const home = await $.env.get('HOME')
    const id = await $.session.id()
    sessionLog = new DebugLog(hostOf($), `${home}/${LOGS_SUBDIR}/${id}.jsonl`, () =>
      new Date().toISOString(),
    )
  }
  activeLog = sessionLog
  return sessionLog
}

const traceOf = (log: DebugLog | undefined, extra: Record<string, unknown>): Trace | undefined =>
  log === undefined ? undefined : (event, data) => log.add(event, { ...extra, ...data })

export function register(on: On): void {
  on('session.start', async ($, e, next) => {
    try {
      if (await isEnabled($)) {
        const created = describeBootstrap(await ensureConfig(hostOf($)))
        if (created !== undefined) {
          isInvalidLogged = true
          $.ui.log(created)
        }
        const r = await loadConfig(hostOf($))
        if (!r.ok) logInvalidOnce($, r)
        else (await logFor($, r.config))?.add('session_start', { provider: r.config.provider })
      }
    } catch {
      logInternal($)
    }
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    isInvalidLogged = false
    const log = sessionLog
    sessionLog = undefined
    activeLog = undefined
    if (log !== undefined) {
      log.add('session_end', {})
      await log.flushed()
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
          const log = await logFor($, r.config)
          const usage = await $.session.usage()
          const tokens = usage.context.tokens
          const candidates = selectCandidates(r.config.models, tokens, r.config.contextReserve)
          log?.add('turn_start', {
            turnId: e.turnId,
            text: redact(e.text),
            contextTokens: tokens,
            contextReserve: r.config.contextReserve,
            candidates: candidates.map((m) => m.id),
            dropped: r.config.models.filter((m) => !candidates.includes(m)).map((m) => m.id),
          })
          const trace = traceOf(log, { turnId: e.turnId })
          turns.start(e.turnId, classify(hostOf($, trace), r.config, e.text, candidates))
        }
      }
    } catch {
      logInternal($, provider)
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const log = activeLog
    let id: string | undefined
    if (e.agentId === undefined) {
      try {
        const outcome = await Promise.race([turns.resolveStep(e), abortOf(next.signal)])
        if (isAborted(outcome)) {
          log?.add('step', { turnId: e.turnId, index: e.index, engineModel: e.model, reason: 'aborted' })
          return
        }
        id = outcome.id
        if (outcome.reason !== 'unknown_turn') {
          log?.add('step', {
            turnId: e.turnId,
            index: e.index,
            engineModel: e.model,
            sent: id ?? e.model,
            reason: outcome.reason,
          })
        }
      } catch {
        logInternal($)
      }
    }
    return yield* next(id === undefined ? e : { ...e, model: id })
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      turns.complete(e.turnId)
      activeLog?.add('turn_complete', { turnId: e.turnId, reason: e.reason })
    }
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
        } else {
          const log = await logFor($, r.config)
          if (!r.config.subagentTypes.includes(e.subagentType)) {
            log?.add('spawn', { subagentType: e.subagentType, skipped: 'type' })
          } else {
            provider = r.config.provider
            const text = `${e.description}\n\n${e.prompt}`
            const trace = traceOf(log, { subagentType: e.subagentType })
            const outcome = await Promise.race([
              classify(hostOf($, trace), r.config, text, r.config.models),
              abortOf(next.signal),
            ])
            if (isAborted(outcome)) {
              log?.add('spawn', { subagentType: e.subagentType, reason: 'aborted' })
              return { deny: 'jev-box: spawn aborted' }
            }
            id = outcome
            log?.add('spawn', { subagentType: e.subagentType, text: redact(text), model: id })
          }
        }
      } else {
        activeLog?.add('spawn', {
          subagentType: e.subagentType,
          skipped: e.fork ? 'fork' : 'explicit_model',
        })
      }
    } catch {
      logInternal($, provider)
    }
    return next(id === undefined ? e : { ...e, model: id })
  })
}
