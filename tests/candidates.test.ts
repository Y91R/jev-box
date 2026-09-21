import { expect, test } from 'bun:test'
import { selectCandidates } from '../hooks/candidates'

const haiku = { id: 'claude-haiku-4-5', description: 'd', contextWindow: 200000 }
const opus = { id: 'claude-opus-5', description: 'd', contextWindow: 1000000 }
const models = [haiku, opus]

test('without a context reading every model is a candidate', () => {
  expect(selectCandidates(models, undefined)).toEqual(models)
})

test('a model whose window equals the context stays', () => {
  expect(selectCandidates(models, 200000)).toEqual(models)
})

test('a model with a smaller window than the context is dropped', () => {
  expect(selectCandidates(models, 200001)).toEqual([opus])
})

test('no model fits', () => {
  expect(selectCandidates(models, 1000001)).toEqual([])
})
