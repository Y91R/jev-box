import type { On } from 'claude-code'

export function register(on: On): void {
  on('session.start', ($, e, next) => next(e))
}
