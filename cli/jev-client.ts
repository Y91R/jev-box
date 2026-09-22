import type { QuestionMap } from '../hooks/core/questions'
import { buildJevRequest, type State } from '../hooks/core/request'
import { parseJevResponse, type ParsedAnswers } from '../hooks/core/response'
import { send, type Http, type Timer } from './transport'

export type CliJevConfig = { url: string; apiKey: string; jevModel: string; timeoutMs: number }

export async function askJev<M extends QuestionMap>(
  io: { http: Http; timer: Timer },
  config: CliJevConfig,
  state: State,
  questions: M,
): Promise<ParsedAnswers<M> | { ok: false; fail: 'network' | 'timeout' }> {
  const req = buildJevRequest({
    url: config.url,
    apiKey: config.apiKey,
    jevModel: config.jevModel,
    state,
    questions,
  })
  const reply = await send(io.http, io.timer, req, config.timeoutMs)
  if ('fail' in reply) return { ok: false, fail: reply.fail }
  return parseJevResponse(reply, questions)
}
