import type { AnswerMap, NoulQuestion } from '../../hooks/core/questions'
import type { Step } from '../extract'

// Растёт при смене смысла любого вопроса: пороги ниже после этого устаревают.
export const QUESTION_VERSION = 1

const JUDGMENTS = {
  manual_action: {
    type: 'noul',
    instructions:
      'Does `step` or `check` require a manual action by a person or an action in another system, such as publishing, deploying or checking by eye?',
  },
  unverified_behavior: {
    type: 'noul',
    instructions:
      'Does `step` rely on how a library, framework or external service behaves without saying how that behaviour is checked?',
  },
} satisfies Record<string, NoulQuestion>

const OBSERVABLE_CHECK = {
  observable_check: {
    type: 'noul',
    instructions: 'Does `check` name a concrete command or test and the result it must show?',
  },
} satisfies Record<string, NoulQuestion>

// Без проверки спрашивать о её качестве нечего: это уже кодовая пометка no_check.
export const questionsFor = (step: Step) =>
  step.check === undefined ? JUDGMENTS : { ...JUDGMENTS, ...OBSERVABLE_CHECK }

export const stateOf = (step: Step) =>
  step.check === undefined ? { step: step.text } : { step: step.text, check: step.check }

export type Signal = 'no_check' | 'no_paths' | 'observable_check' | 'manual_action' | 'unverified_behavior'
export type Zone = 'flag' | 'discretion'
export type Finding = { id: string; line: number; signal: Signal; value?: number; zone: Zone }
export type Answers = AnswerMap<typeof JUDGMENTS> & Partial<AnswerMap<typeof OBSERVABLE_CHECK>>

// Ключ набора tests/fixtures/calibration/labels.tsv: пороги ниже верны только для него.
export const CALIBRATION = { model: 'jev-1.13.0', questionVersion: 1, language: 'ru', providers: ['typesafe'] } as const

type JevSignal = 'observable_check' | 'manual_action' | 'unverified_behavior'

const THRESHOLDS: Record<JevSignal, { flag: number; discretion: number }> = {
  observable_check: { flag: 0.7, discretion: 0.5 },
  manual_action: { flag: 0.95, discretion: 0.85 },
  unverified_behavior: { flag: 0.85, discretion: 0.75 },
}

export const LIMITATIONS = [
  'пороги откалиброваны предварительно: jev-1.13.0, вопросы v1, ru, typesafe; дефектов в наборе мало (tests/fixtures/calibration)',
  'шаги ищутся только в форматах «## Шаг N» и «### N.» под «## Решение»',
]

const zoneOf = (signal: JevSignal, bad: number): Zone | undefined =>
  bad >= THRESHOLDS[signal].flag ? 'flag' : bad >= THRESHOLDS[signal].discretion ? 'discretion' : undefined

export function codeFindingsOf(step: Step): Finding[] {
  const findings: Finding[] = []
  if (step.check === undefined) findings.push({ id: step.id, line: step.line, signal: 'no_check', zone: 'flag' })
  if (step.paths.length === 0) findings.push({ id: step.id, line: step.line, signal: 'no_paths', zone: 'flag' })
  return findings
}

// observable_check — положительное свойство: помечается низкое значение.
export function findingsOf(step: Step, answers: Answers): Finding[] {
  const measured: [JevSignal, number, number][] = [
    ['manual_action', answers.manual_action.noul, answers.manual_action.noul],
    ['unverified_behavior', answers.unverified_behavior.noul, answers.unverified_behavior.noul],
  ]
  if (answers.observable_check !== undefined) {
    const v = answers.observable_check.noul
    measured.unshift(['observable_check', v, 1 - v])
  }
  const findings: Finding[] = []
  for (const [signal, value, bad] of measured) {
    const zone = zoneOf(signal, bad)
    if (zone !== undefined) findings.push({ id: step.id, line: step.line, signal, value, zone })
  }
  return findings
}
