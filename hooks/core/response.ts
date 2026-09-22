import type { AnswerMap, Question, QuestionMap } from './questions'

type Json = Record<string, unknown>

export type AnswerFailure = {
  key: string
  reason:
    | 'wrong_type'
    | 'missing_field'
    | 'out_of_range'
    | 'choice_not_in_criteria'
    | 'probabilities_mismatch'
}

export type ParsedAnswers<M extends QuestionMap> =
  | { ok: true; jevModel: string | undefined; answers: AnswerMap<M> }
  | { ok: false; fail: `http_${number}` | 'malformed' }
  | { ok: false; fail: 'invalid'; errors: AnswerFailure[] }

const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const isUnit = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1

const bodyOf = (text: string): Json | undefined => {
  try {
    const body: unknown = JSON.parse(text)
    return isObject(body) ? body : undefined
  } catch {
    return undefined
  }
}

export function peekAnswer(text: string, key: string): Json | undefined {
  const answers = bodyOf(text)?.answers
  const answer = isObject(answers) ? answers[key] : undefined
  return isObject(answer) ? answer : undefined
}

export function peekModel(text: string): string | undefined {
  const model = bodyOf(text)?.model
  return typeof model === 'string' ? model : undefined
}

function probabilitiesFault(p: unknown, keys: readonly string[]): AnswerFailure['reason'] | undefined {
  if (p === undefined) return undefined
  if (!isObject(p) || !keys.every((k) => k in p)) return 'probabilities_mismatch'
  return Object.values(p).every(isUnit) ? undefined : 'out_of_range'
}

function faultOf(q: Question, a: unknown): AnswerFailure['reason'] | undefined {
  if (!isObject(a) || a.type !== q.type) return 'wrong_type'
  if (a.confidence !== undefined && !isUnit(a.confidence)) return 'out_of_range'

  if (q.type === 'noul') {
    if (a.noul === undefined) return 'missing_field'
    return isUnit(a.noul) ? undefined : 'out_of_range'
  }

  if (q.type === 'choice') {
    if (typeof a.choice !== 'string') return 'missing_field'
    const options = Object.keys(q.criteria)
    if (!options.includes(a.choice)) return 'choice_not_in_criteria'
    return probabilitiesFault(a.probabilities, options)
  }

  if (typeof a.score !== 'number') return 'missing_field'
  if (a.score < 0 || a.score > q.criteria.length - 1) return 'out_of_range'
  return probabilitiesFault(
    a.probabilities,
    q.criteria.map((_, i) => String(i)),
  )
}

export function parseJevResponse<M extends QuestionMap>(
  res: { status: number; text: string },
  questions: M,
): ParsedAnswers<M> {
  if (res.status < 200 || res.status > 299) return { ok: false, fail: `http_${res.status}` }

  const body = bodyOf(res.text)
  if (body === undefined || !isObject(body.answers)) return { ok: false, fail: 'malformed' }
  const answers = body.answers

  const errors: AnswerFailure[] = []
  for (const [key, question] of Object.entries(questions)) {
    const reason = faultOf(question, answers[key])
    if (reason !== undefined) errors.push({ key, reason })
  }
  if (errors.length > 0) return { ok: false, fail: 'invalid', errors }

  return {
    ok: true,
    jevModel: typeof body.model === 'string' ? body.model : undefined,
    answers: answers as AnswerMap<M>,
  }
}
