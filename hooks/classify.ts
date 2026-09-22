import type { Config, Model } from './config'
import {
  answerOf,
  buildRequest,
  parseResponse,
  type Decision,
  type FailCode,
  type JevRequest,
} from './jev'

export type Trace = (event: string, data: Record<string, unknown>) => void

export type ClassifyHost = {
  http: { fetch: (url: string, init: JevRequest['init']) => Promise<{ status: number; text: string }> }
  clock: { sleep: (ms: number) => Promise<void> }
  ui: { log: (text: string) => void }
  trace?: Trace
}

async function ask(
  $: ClassifyHost,
  config: Config,
  text: string,
  candidates: readonly Model[],
): Promise<Decision> {
  const { provider } = config
  const { url, init } = buildRequest(config, text, candidates)
  $.trace?.('jev_request', {
    provider,
    url,
    jevModel: config[provider].model,
    candidates: candidates.map((m) => m.id),
    timeoutMs: config.timeoutMs,
  })
  const startedAt = Date.now()
  const reply = await Promise.race([
    $.http.fetch(url, init).then(
      (res) => ({ res }),
      () => ({ fail: 'network' as const }),
    ),
    $.clock.sleep(config.timeoutMs).then(() => ({ fail: 'timeout' as const })),
  ])
  const ms = Date.now() - startedAt
  if ('fail' in reply) {
    $.trace?.('jev_failure', { provider, code: reply.fail, ms })
    return reply
  }
  const answer = answerOf(reply.res.text)
  $.trace?.('jev_response', {
    provider,
    status: reply.res.status,
    ms,
    choice: answer?.choice,
    confidence: answer?.confidence,
    probabilities: answer?.probabilities,
  })
  return parseResponse(reply.res, config, candidates)
}

export async function classify(
  $: ClassifyHost,
  config: Config,
  text: string,
  candidates: readonly Model[],
): Promise<string | undefined> {
  if (candidates.length === 0) {
    $.trace?.('decision', { none: 'no_candidates' })
    return undefined
  }
  let decision: Decision
  try {
    decision = await ask($, config, text, candidates)
  } catch {
    decision = { fail: 'internal' }
  }
  $.trace?.('decision', 'id' in decision ? { id: decision.id } : { none: 'none' in decision ? decision.none : decision.fail })
  if ('id' in decision) return decision.id
  if ('fail' in decision) logFailure($, config, decision.fail)
  return undefined
}

export function logFailure($: Pick<ClassifyHost, 'ui'>, config: Config, code: FailCode): void {
  $.ui.log(`jev-box: ${config.provider} ${code}`)
}
