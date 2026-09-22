import type { AnswerMap, NoulQuestion } from '../../hooks/core/questions'
import type { Item } from '../extract'

// Растёт при смене смысла любого вопроса: пороги ниже после этого устаревают.
export const QUESTION_VERSION = 1

export const QUESTIONS = {
  observable: {
    type: 'noul',
    instructions: 'Does the requirement name a result or effect that a test can observe?',
  },
  several_rules: {
    type: 'noul',
    instructions:
      'Does the requirement contain more than one independent rule that would be tested separately?',
  },
  vague_word: {
    type: 'noul',
    instructions:
      'Does the requirement use an evaluative word such as fast, convenient, correct or if necessary without a stated threshold or criterion?',
  },
} satisfies Record<string, NoulQuestion>

export type Signal = keyof typeof QUESTIONS
export type Zone = 'flag' | 'discretion'
export type Finding = { id: string; line: number; signal: Signal; value: number; zone: Zone }
export type Measurement = { id: string; line: number; values: Record<Signal, number> }

// several_rules измеряется, но в подсказки не входит: на model_choice.md он пометил 21 требование
// из 29 — любое со списком условий (решение пользователя от 2026-09-22).
export const HINT_SIGNALS: readonly Signal[] = ['observable', 'vague_word']

// Некалиброванные пороги (docs/plans/README.md, шлагбаум калибровки).
const FLAG = 0.7
const DISCRETION = 0.5

export const LIMITATIONS = [
  'пороги не откалиброваны на русских СТ',
  'несколько правил в одном пункте не подсказываются: сигнал помечает любой список условий',
]

// observable — положительное свойство: помечается низкое значение.
const zoneOf = (signal: Signal, noul: number): Zone | undefined => {
  const v = signal === 'observable' ? 1 - noul : noul
  if (v >= FLAG) return 'flag'
  if (v >= DISCRETION) return 'discretion'
  return undefined
}

export const measurementOf = (item: Item, answers: AnswerMap<typeof QUESTIONS>): Measurement => ({
  id: item.id,
  line: item.line,
  values: {
    observable: answers.observable.noul,
    several_rules: answers.several_rules.noul,
    vague_word: answers.vague_word.noul,
  },
})

export function findingsOf(item: Item, answers: AnswerMap<typeof QUESTIONS>): Finding[] {
  const findings: Finding[] = []
  for (const signal of HINT_SIGNALS) {
    const value = answers[signal].noul
    const zone = zoneOf(signal, value)
    if (zone !== undefined) findings.push({ id: item.id, line: item.line, signal, value, zone })
  }
  return findings
}
