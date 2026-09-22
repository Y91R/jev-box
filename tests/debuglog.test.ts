import { expect, test } from 'bun:test'
import { DebugLog, redact, type DebugLogHost } from '../hooks/debuglog'

const host = (existing?: string, opts: { failWrites?: number } = {}) => {
  const files: Record<string, string> = existing === undefined ? {} : { '/log.jsonl': existing }
  let failures = opts.failWrites ?? 0
  const $: DebugLogHost = {
    fs: {
      read: async (path) => {
        const text = files[path]
        if (text === undefined) throw new Error('ENOENT')
        return text
      },
      write: async (path, text) => {
        if (failures > 0) {
          failures -= 1
          throw new Error('EACCES')
        }
        files[path] = text
      },
    },
  }
  return { $, files }
}

let tick = 0
const clock = () => `t${tick++}`
const events = (text: string | undefined) =>
  (text ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l))

test('writes one JSON object per line, in order', async () => {
  const { $, files } = host()
  const log = new DebugLog($, '/log.jsonl', () => 'T')
  log.add('turn_start', { turnId: 'a' })
  log.add('step', { turnId: 'a', index: 0 })
  await log.flushed()
  expect(events(files['/log.jsonl'])).toEqual([
    { ts: 'T', event: 'turn_start', turnId: 'a' },
    { ts: 'T', event: 'step', turnId: 'a', index: 0 },
  ])
})

test('keeps only the last max lines', async () => {
  const { $, files } = host()
  const log = new DebugLog($, '/log.jsonl', clock, 3)
  for (let i = 0; i < 5; i++) log.add('e', { i })
  await log.flushed()
  expect(events(files['/log.jsonl']).map((e) => e.i)).toEqual([2, 3, 4])
})

test('continues the file of the same session after a reload', async () => {
  const { $, files } = host('{"ts":"old","event":"turn_start"}\n')
  const log = new DebugLog($, '/log.jsonl', () => 'new')
  log.add('step', {})
  await log.flushed()
  expect(events(files['/log.jsonl']).map((e) => e.ts)).toEqual(['old', 'new'])
})

test('a failed write is swallowed and the next write still lands', async () => {
  const { $, files } = host(undefined, { failWrites: 1 })
  const log = new DebugLog($, '/log.jsonl', () => 'T')
  log.add('a', {})
  await log.flushed()
  expect(files['/log.jsonl']).toBeUndefined()
  log.add('b', {})
  await log.flushed()
  expect(events(files['/log.jsonl']).map((e) => e.event)).toEqual(['a', 'b'])
})

test('an unserializable entry is dropped without throwing', async () => {
  const { $, files } = host()
  const log = new DebugLog($, '/log.jsonl', () => 'T')
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  expect(() => log.add('bad', cycle)).not.toThrow()
  log.add('good', {})
  await log.flushed()
  expect(events(files['/log.jsonl']).map((e) => e.event)).toEqual(['good'])
})

test('redact keeps the first 200 characters and the full length', () => {
  const text = 'x'.repeat(250)
  expect(redact(text)).toEqual({ length: 250, head: 'x'.repeat(200) })
  expect(redact('short')).toEqual({ length: 5, head: 'short' })
})
