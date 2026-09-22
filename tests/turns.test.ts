import { expect, test } from 'bun:test'
import { Turns } from '../hooks/turns'

const step = (index: number, model = 'claude-opus-5') => ({ turnId: 't1', index, model })

test('every step of the turn gets the decision', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-haiku-4-5'))
  const switched = { id: 'claude-haiku-4-5', reason: 'switched' }
  expect(await turns.resolveStep(step(0))).toEqual(switched)
  expect(await turns.resolveStep(step(1))).toEqual(switched)
  expect(await turns.resolveStep(step(2))).toEqual(switched)
})

test('a step on another engine model is an engine fallback and is left alone', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-opus-5'))
  expect(await turns.resolveStep(step(0, 'claude-fable-5-1'))).toEqual({
    id: 'claude-opus-5',
    reason: 'switched',
  })
  expect(await turns.resolveStep(step(1, 'claude-opus-4-8'))).toEqual({ reason: 'fallback' })
})

test('a repeated step 0 on a fallback model is left alone', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-haiku-4-5'))
  expect((await turns.resolveStep(step(0, 'claude-opus-5'))).id).toBe('claude-haiku-4-5')
  expect(await turns.resolveStep(step(0, 'claude-sonnet-5'))).toEqual({ reason: 'fallback' })
  expect((await turns.resolveStep(step(1, 'claude-opus-5'))).id).toBe('claude-haiku-4-5')
})

test('a turn whose step 0 never reached the plugin is not switched', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-haiku-4-5'))
  expect(await turns.resolveStep(step(1, 'claude-sonnet-5'))).toEqual({ reason: 'step0_missing' })
  expect(await turns.resolveStep(step(2, 'claude-sonnet-5'))).toEqual({ reason: 'step0_missing' })
})

test('no decision passes every step through', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve(undefined))
  expect(await turns.resolveStep(step(0))).toEqual({ reason: 'no_decision' })
})

test('an unknown turn passes through', async () => {
  expect(await new Turns().resolveStep(step(0))).toEqual({ reason: 'unknown_turn' })
})

test('a step waits for a pending decision', async () => {
  const turns = new Turns()
  let decide: (id: string) => void = () => {}
  turns.start('t1', new Promise((r) => (decide = r)))
  const pending = turns.resolveStep(step(0))
  decide('claude-sonnet-5')
  expect(await pending).toEqual({ id: 'claude-sonnet-5', reason: 'switched' })
})

test('complete forgets the turn', async () => {
  const turns = new Turns()
  turns.start('t1', Promise.resolve('claude-haiku-4-5'))
  turns.complete('t1')
  expect(turns.size).toBe(0)
  expect(await turns.resolveStep(step(0))).toEqual({ reason: 'unknown_turn' })
})
