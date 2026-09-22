import type { JevRequest } from '../hooks/core/request'

export type Http = (
  url: string,
  init: JevRequest['init'],
) => Promise<{ status: number; text: string }>

export type Sleep = (ms: number) => Promise<void>

export type Reply = { status: number; text: string } | { fail: 'network' | 'timeout' }

export function send(http: Http, sleep: Sleep, req: JevRequest, timeoutMs: number): Promise<Reply> {
  return Promise.race([
    http(req.url, req.init).then(
      (res): Reply => res,
      (): Reply => ({ fail: 'network' }),
    ),
    sleep(timeoutMs).then((): Reply => ({ fail: 'timeout' })),
  ])
}
