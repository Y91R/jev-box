import type { Config, Model } from './config'
import { buildRequest, parseResponse, type Decision, type FailCode, type JevRequest } from './jev'

export type ClassifyHost = {
  http: { fetch: (url: string, init: JevRequest['init']) => Promise<{ status: number; text: string }> }
  clock: { sleep: (ms: number) => Promise<void> }
  ui: { log: (text: string) => void }
}

async function ask(
  $: ClassifyHost,
  config: Config,
  text: string,
  candidates: readonly Model[],
): Promise<Decision> {
  const { url, init } = buildRequest(config, text, candidates)
  const reply = await Promise.race([
    $.http.fetch(url, init).then(
      (res) => ({ res }),
      () => ({ fail: 'network' as const }),
    ),
    $.clock.sleep(config.timeoutMs).then(() => ({ fail: 'timeout' as const })),
  ])
  if ('fail' in reply) return reply
  return parseResponse(reply.res, config, candidates)
}

export async function classify(
  $: ClassifyHost,
  config: Config,
  text: string,
  candidates: readonly Model[],
): Promise<string | undefined> {
  if (candidates.length === 0) return undefined
  let decision: Decision
  try {
    decision = await ask($, config, text, candidates)
  } catch {
    decision = { fail: 'internal' }
  }
  if ('id' in decision) return decision.id
  if ('fail' in decision) logFailure($, config, decision.fail)
  return undefined
}

export function logFailure($: Pick<ClassifyHost, 'ui'>, config: Config, code: FailCode): void {
  $.ui.log(`jev-box: ${config.provider} ${code}`)
}
