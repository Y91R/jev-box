import { describe, expect, test } from 'bun:test'
import { send, type Http, type Timer } from '../../cli/transport'

const req = {
  url: 'https://example.test/decide',
  init: { method: 'POST' as const, headers: {}, body: '{}' },
}

const never = <T>() => new Promise<T>(() => {})

const timerOf = (fires: boolean) => {
  const log: string[] = []
  const timer: Timer = (ms) => {
    log.push(`start ${ms}`)
    return { elapsed: fires ? Promise.resolve() : never(), cancel: () => log.push('cancel') }
  }
  return { timer, log }
}

describe('send', () => {
  test('a reply before the timeout is passed as it is and the timer is cancelled', async () => {
    const { timer, log } = timerOf(false)
    const http: Http = () => Promise.resolve({ status: 200, text: 'ok' })
    expect(await send(http, timer, req, 4321)).toEqual({ status: 200, text: 'ok' })
    expect(log).toEqual(['start 4321', 'cancel'])
  })

  test('no reply before the timer fires is a timeout', async () => {
    const { timer } = timerOf(true)
    expect(await send(() => never(), timer, req, 1000)).toEqual({ fail: 'timeout' })
  })

  test('a rejected request is a network failure and the timer is cancelled', async () => {
    const { timer, log } = timerOf(false)
    const http: Http = () => Promise.reject(new Error('down'))
    expect(await send(http, timer, req, 1000)).toEqual({ fail: 'network' })
    expect(log).toEqual(['start 1000', 'cancel'])
  })
})
