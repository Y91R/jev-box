import type { JevRequest } from '../hooks/core/request'

export type Http = (
  url: string,
  init: JevRequest['init'],
) => Promise<{ status: number; text: string }>

// Таймер обязан отменяться: иначе после быстрого ответа он держит процесс до конца таймаута.
export type Timer = (ms: number) => { elapsed: Promise<void>; cancel: () => void }

export type Reply = { status: number; text: string } | { fail: 'network' | 'timeout' }

export async function send(http: Http, timer: Timer, req: JevRequest, timeoutMs: number): Promise<Reply> {
  const t = timer(timeoutMs)
  try {
    return await Promise.race([
      http(req.url, req.init).then(
        (res): Reply => res,
        (): Reply => ({ fail: 'network' }),
      ),
      t.elapsed.then((): Reply => ({ fail: 'timeout' })),
    ])
  } finally {
    t.cancel()
  }
}
