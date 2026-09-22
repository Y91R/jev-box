import type { QuestionMap } from './questions'

export const ENDPOINTS = {
  typesafe: 'https://api.typesafe.ai/v1/systemone',
  openrouter: 'https://openrouter.ai/api/alpha/decisions',
} as const

// state по api.md: строка, объект или массив; вопросы ссылаются на поля объекта в бэктиках.
export type State = string | Record<string, unknown> | readonly unknown[]

export type JevRequest = {
  url: string
  init: { method: 'POST'; headers: Record<string, string>; body: string }
}

export function buildJevRequest<M extends QuestionMap>(p: {
  url: string
  apiKey: string
  jevModel: string
  state: State
  questions: M
}): JevRequest {
  return {
    url: p.url,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${p.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: p.jevModel, state: p.state, questions: p.questions }),
    },
  }
}
