export type DebugLogHost = {
  fs: {
    read: (path: string) => Promise<string>
    write: (path: string, text: string) => Promise<void>
  }
}

export const LOGS_SUBDIR = '.config/jev-box/logs'
const TEXT_HEAD = 200

export const redact = (text: string) => ({ length: text.length, head: text.slice(0, TEXT_HEAD) })

export class DebugLog {
  private lines: string[] = []
  private pending: Promise<void>

  constructor(
    private readonly host: DebugLogHost,
    private readonly path: string,
    private readonly now: () => string,
    private readonly max = 2000,
  ) {
    this.pending = host.fs.read(path).then(
      (text) => {
        this.lines = [...text.split('\n').filter((l) => l !== ''), ...this.lines]
      },
      () => {},
    )
  }

  add(event: string, data: Record<string, unknown> = {}): void {
    let line: string
    try {
      line = JSON.stringify({ ts: this.now(), event, ...data })
    } catch {
      return
    }
    this.lines.push(line)
    this.pending = this.pending
      .then(() => {
        if (this.lines.length > this.max) this.lines = this.lines.slice(-this.max)
        return this.host.fs.write(this.path, this.lines.join('\n') + '\n')
      })
      .catch(() => {})
  }

  flushed(): Promise<void> {
    return this.pending
  }
}
