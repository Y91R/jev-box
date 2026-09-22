import type { QuestionMap } from './questions'

export type JevRequest = {
  url: string
  init: { method: 'POST'; headers: Record<string, string>; body: string }
}

export function buildJevRequest<M extends QuestionMap>(p: {
  url: string
  apiKey: string
  jevModel: string
  state: string
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
