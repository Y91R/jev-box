import type { Config, Model, Provider } from './config'
import type { ChoiceQuestion } from './core/questions'
import { buildJevRequest, type JevRequest } from './core/request'
import { parseJevResponse, peekAnswer, peekModel } from './core/response'

export type { JevRequest }

export const ENDPOINTS: Record<Provider, string> = {
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  openrouter: 'https://openrouter.ai/api/alpha/decisions',
}

export const QUESTION = 'Which Claude model should handle this task?'
// Растёт при смене смысла QUESTION: калибровка minConfidence после этого устаревает.
export const QUESTION_VERSION = 1

export type FailCode =
  | 'network'
  | 'timeout'
  | `http_${number}`
  | 'bad_response'
  | 'unknown_model'
  | 'internal'

export type Decision =
  | { id: string }
  | { none: 'low_confidence' }
  | { fail: FailCode }

const modelQuestion = (candidates: readonly Model[]): { model: ChoiceQuestion } => ({
  model: {
    type: 'choice',
    instructions: QUESTION,
    criteria: Object.fromEntries(candidates.map((m) => [m.id, m.description])),
  },
})

export function buildRequest(
  config: Config,
  text: string,
  candidates: readonly Model[],
): JevRequest {
  const section = config[config.provider]
  return buildJevRequest({
    url: ENDPOINTS[config.provider],
    apiKey: section.apiKey ?? '',
    jevModel: section.model,
    state: text,
    questions: modelQuestion(candidates),
  })
}

export const answerOf = (text: string) => peekAnswer(text, 'model')

export const responseModelOf = peekModel

export function parseResponse(
  res: { status: number; text: string },
  config: Config,
  candidates: readonly Model[],
): Decision {
  const parsed = parseJevResponse(res, modelQuestion(candidates))
  if (!parsed.ok) {
    if (parsed.fail === 'malformed') return { fail: 'bad_response' }
    if (parsed.fail === 'invalid') {
      const unknown = parsed.errors.some((e) => e.reason === 'choice_not_in_criteria')
      return { fail: unknown ? 'unknown_model' : 'bad_response' }
    }
    return { fail: parsed.fail }
  }

  const answer = parsed.answers.model
  if (config.minConfidence !== undefined) {
    if (answer.confidence === undefined || answer.confidence < config.minConfidence) {
      return { none: 'low_confidence' }
    }
  }
  return { id: answer.choice }
}
