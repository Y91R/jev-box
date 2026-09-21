import { expect, test } from 'bun:test'
import { Turns } from '../hooks/turns'

const step = (index: number, model = 'claude-opus-5') => ({ turnId: 't1', index, model })

test('every step of the turn gets the decision', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-haiku-4-5'))
  expect(await turns.resolveStep(step(0))).toBe('claude-haiku-4-5')
  expect(await turns.resolveStep(step(1))).toBe('claude-haiku-4-5')
  expect(await turns.resolveStep(step(2))).toBe('claude-haiku-4-5')
})

test('a step on another engine model is an engine fallback and is left alone', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-opus-5'))
  expect(await turns.resolveStep(step(0, 'claude-fable-5-1'))).toBe('claude-opus-5')
  expect(await turns.resolveStep(step(1, 'claude-opus-4-8'))).toBeUndefined()
})

test('no decision passes every step through', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve(undefined))
  expect(await turns.resolveStep(step(0))).toBeUndefined()
})

test('an unknown turn passes through', async () => {
  expect(await new Turns().resolveStep(step(0))).toBeUndefined()
})

test('a step waits for a pending decision', async () => {
  const turns = new Turns()
  let decide: (id: string) => void = () => {}
  turns.start('t1', new Promise((r) => (decide = r)))
  const pending = turns.resolveStep(step(0))
  decide('claude-sonnet-5')
  expect(await pending).toBe('claude-sonnet-5')
})

test('complete forgets the turn', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-haiku-4-5'))
  turns.complete('t1')
  expect(turns.size).toBe(0)
  expect(await turns.resolveStep(step(0))).toBeUndefined()
})
