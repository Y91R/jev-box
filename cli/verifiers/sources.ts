import type { AnswerMap, ChoiceQuestion } from '../../hooks/core/questions'
import type { Item } from '../extract'
import type { Passage } from '../passages'

// Растёт при смене смысла любого вопроса: порог ниже после этого устаревает.
export const QUESTION_VERSION = 1

export const NONE = 'none'

export const LIMITATIONS = [
  'порог уверенности не откалиброван на русских СТ',
  'проверено только «не выдумано ли»: потерянные ограничения источника не ищутся',
  'кандидаты отбираются по общим основам слов — требование, пересказанное синонимами, может остаться без фрагмента',
  'требование сверяется с одним фрагментом: опора, разнесённая по нескольким абзацам, не распознаётся',
]

// Заголовок участвует в отборе кандидатов, поэтому Jev видит его вместе с текстом фрагмента.
export const passageText = (p: Passage): string => (p.heading === undefined ? p.text : `${p.heading}: ${p.text}`)

export const locateQuestions = (candidates: readonly Passage[]) => ({
  locate: {
    type: 'choice',
    instructions:
      'Which passage speaks about the same thing as `requirement`, whether it agrees with it or not?',
    criteria: {
      ...Object.fromEntries(candidates.map((p) => [p.id, passageText(p)])),
      [NONE]: 'No passage speaks about what the requirement states',
    },
  } as ChoiceQuestion,
})

export const RELATION_QUESTIONS = {
  relation: {
    type: 'choice',
    instructions: 'How does `section` relate to `claim`?',
    criteria: {
      supports: 'The section states the claim or directly implies that it is true',
      contradicts: 'The section states the opposite of the claim or implies it is false',
      says_nothing: 'The section does not address what the claim asserts, either way',
    },
  } as ChoiceQuestion<'supports' | 'contradicts' | 'says_nothing'>,
}

export type Signal = 'unsupported' | 'contradicts'
export type Zone = 'flag' | 'discretion'
export type Finding = {
  id: string
  line: number
  signal: Signal
  confidence: number | undefined
  zone: Zone
  passage?: { id: string; line: number }
}

// Порог автопринятия вердикта из cookbooks/citation_check.md; ниже — «на усмотрение».
const AUTO_ACCEPT = 0.8

const zoneOf = (confidence: number | undefined): Zone =>
  confidence !== undefined && confidence >= AUTO_ACCEPT ? 'flag' : 'discretion'

export function findingsOf(
  item: Item,
  located: AnswerMap<ReturnType<typeof locateQuestions>>,
  relation: AnswerMap<typeof RELATION_QUESTIONS> | undefined,
  passages: readonly Passage[],
): Finding[] {
  const { choice, confidence } = located.locate
  const base = { id: item.id, line: item.line }
  if (choice === NONE || relation === undefined) {
    return [{ ...base, signal: 'unsupported', confidence, zone: zoneOf(confidence) }]
  }
  const passage = passages.find((p) => p.id === choice)
  const where = passage === undefined ? {} : { passage: { id: passage.id, line: passage.line } }
  const verdict = relation.relation
  if (verdict.choice === 'supports') return []
  return [
    {
      ...base,
      signal: verdict.choice === 'contradicts' ? 'contradicts' : 'unsupported',
      confidence: verdict.confidence,
      zone: zoneOf(verdict.confidence),
      ...where,
    },
  ]
}
