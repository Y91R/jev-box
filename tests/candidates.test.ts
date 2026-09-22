import { expect, test } from 'bun:test'
import { selectCandidates } from '../hooks/candidates'

const haiku = { id: 'claude-haiku-4-5', description: 'd', contextWindow: 200000 }
const opus = { id: 'claude-opus-5', description: 'd', contextWindow: 1000000 }
const models = [haiku, opus]

test('without a context reading every model is a candidate', () => {
  expect(selectCandidates(models, undefined, 0.5)).toEqual(models)
})

test('a model stays while the context fills at most the reserved share of its window', () => {
  expect(selectCandidates(models, 100000, 0.5)).toEqual(models)
})

test('a model is dropped once the context passes the reserved share', () => {
  expect(selectCandidates(models, 100001, 0.5)).toEqual([opus])
})

test('195K of a 200K window is too close under the default reserve', () => {
  expect(selectCandidates(models, 195000, 0.5)).toEqual([opus])
})

test('a reserve of 1 allows the whole window', () => {
  expect(selectCandidates(models, 200000, 1)).toEqual(models)
})

test('no model fits', () => {
  expect(selectCandidates(models, 500001, 0.5)).toEqual([])
})
