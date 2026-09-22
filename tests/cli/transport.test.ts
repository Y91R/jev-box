import { describe, expect, test } from 'bun:test'
import { send, type Http, type Sleep } from '../../cli/transport'

const req = {
  url: 'https://example.test/decide',
  init: { method: 'POST' as const, headers: {}, body: '{}' },
}

const never = <T>() => new Promise<T>(() => {})
const fired: Sleep = () => Promise.resolve()
const idle: Sleep = () => never()

describe('send', () => {
  test('a reply before the timeout is passed as it is', async () => {
    const http: Http = () => Promise.resolve({ status: 200, text: 'ok' })
    expect(await send(http, idle, req, 1000)).toEqual({ status: 200, text: 'ok' })
  })

  test('no reply before the timer fires is a timeout', async () => {
    expect(await send(() => never(), fired, req, 1000)).toEqual({ fail: 'timeout' })
  })

  test('a rejected request is a network failure', async () => {
    const http: Http = () => Promise.reject(new Error('down'))
    expect(await send(http, idle, req, 1000)).toEqual({ fail: 'network' })
  })

  test('the timer gets the configured timeout', async () => {
    const waits: number[] = []
    const sleep: Sleep = (ms) => {
      waits.push(ms)
      return never()
    }
    await send(() => Promise.resolve({ status: 200, text: '' }), sleep, req, 4321)
    expect(waits).toEqual([4321])
  })
})
