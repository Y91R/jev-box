export type NoulQuestion = { type: 'noul'; instructions: string }

export type ChoiceQuestion<O extends string = string> = {
  type: 'choice'
  instructions: string
  criteria: Record<O, string>
}

export type ScoreQuestion = { type: 'score'; instructions: string; criteria: string[] }

export type Question = NoulQuestion | ChoiceQuestion | ScoreQuestion

export type NoulAnswer = { type: 'noul'; noul: number }

export type ChoiceAnswer<O extends string = string> = {
  type: 'choice'
  choice: O
  probabilities?: Record<O, number>
  confidence?: number
}

export type ScoreAnswer = {
  type: 'score'
  score: number
  legend?: Record<string, string>
  probabilities?: Record<string, number>
  confidence?: number
}

export type AnswerOf<Q> = Q extends NoulQuestion
  ? NoulAnswer
  : Q extends ChoiceQuestion<infer O>
    ? ChoiceAnswer<O>
    : Q extends ScoreQuestion
      ? ScoreAnswer
      : never

export type QuestionMap = Record<string, Question>

export type AnswerMap<M extends QuestionMap> = { [K in keyof M]: AnswerOf<M[K]> }
