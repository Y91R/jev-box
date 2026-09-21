import type { Config, Model, Provider } from './config'

export const ENDPOINTS: Record<Provider, string> = {
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  openrouter: 'https://openrouter.ai/api/alpha/decisions',
}

export const QUESTION = 'Which Claude model should handle this task?'

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

export type JevRequest = {
  url: string
  init: { method: 'POST'; headers: Record<string, string>; body: string }
}

export function buildRequest(
  config: Config,
  text: string,
  candidates: readonly Model[],
): JevRequest {
  const section = config[config.provider]
  const criteria = Object.fromEntries(candidates.map((m) => [m.id, m.description]))
  return {
    url: ENDPOINTS[config.provider],
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${section.apiKey ?? ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: section.model,
        state: text,
        questions: {
          model: { type: 'choice', instructions: QUESTION, criteria },
        },
      }),
    },
  }
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseResponse(
  res: { status: number; text: string },
  config: Config,
  candidates: readonly Model[],
): Decision {
  if (res.status < 200 || res.status > 299) return { fail: `http_${res.status}` }

  let body: unknown
  try {
    body = JSON.parse(res.text)
  } catch {
    return { fail: 'bad_response' }
  }
  const answer = isObject(body) && isObject(body.answers) ? body.answers.model : undefined
  if (!isObject(answer) || typeof answer.choice !== 'string') {
    return { fail: 'bad_response' }
  }

  if (config.minConfidence !== undefined) {
    const confidence = answer.confidence
    if (typeof confidence !== 'number' || confidence < config.minConfidence) {
      return { none: 'low_confidence' }
    }
  }

  const id = answer.choice
  if (!candidates.some((m) => m.id === id)) return { fail: 'unknown_model' }
  return { id }
}
