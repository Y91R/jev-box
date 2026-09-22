import { run } from './run'
import type { Timer } from './transport'

const timer: Timer = (ms) => {
  let id: ReturnType<typeof setTimeout> | undefined
  const elapsed = new Promise<void>((resolve) => {
    id = setTimeout(resolve, ms)
  })
  return { elapsed, cancel: () => clearTimeout(id) }
}

const code = await run(
  {
    http: async (url, init, signal) => {
      const res = await fetch(url, { ...init, signal })
      return { status: res.status, text: await res.text() }
    },
    timer,
    readFile: (path) => Bun.file(path).text(),
    env: (name) => process.env[name],
    out: (text) => console.log(text),
  },
  process.argv.slice(2),
)
process.exit(code)
