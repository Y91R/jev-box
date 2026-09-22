import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

const script = `${import.meta.dir}/../skills/review-plan/review-plan.sh`

// Заглушки общих скриптов: peer-транспорта нет, «ревьюер» печатает полученный промпт.
const fakeHome = () => {
  const home = mkdtempSync(`${process.env.TMPDIR ?? tmpdir()}/review-plan-`)
  mkdirSync(`${home}/.claude/scripts`, { recursive: true })
  writeFileSync(`${home}/.claude/scripts/peer-available.sh`, 'exit 3\n')
  writeFileSync(`${home}/.claude/scripts/external-review.sh`, 'cat "$1"\n')
  writeFileSync(`${home}/plan.md`, '# План\n')
  return home
}

const runScript = (home: string, env: Record<string, string>, ...args: string[]) => {
  const r = Bun.spawnSync(['bash', script, ...args], { env: { ...process.env, ...env, HOME: home } })
  return r.stdout.toString()
}

describe('review-plan.sh in the plugin', () => {
  test('appends the hints file to the reviewer prompt, quotes and shell characters as they are', () => {
    const home = fakeHome()
    const hints = `Дешёвый проход пометил шаги: Шаг 3 — план 'o'$(touch ${home}/pwned)"; \`id\`.`
    writeFileSync(`${home}/hints.txt`, hints)
    const out = runScript(home, { JEV_HINTS_FILE: `${home}/hints.txt` }, `${home}/plan.md`)
    expect(out).toContain('Ты — сторонний ревьюер плана реализации.')
    expect(out.trimEnd()).toEndWith(hints)
    expect(existsSync(`${home}/pwned`)).toBe(false)
  })

  test('a missing or empty hints file adds nothing', () => {
    const home = fakeHome()
    writeFileSync(`${home}/empty.txt`, '')
    for (const file of [`${home}/empty.txt`, `${home}/none.txt`]) {
      const out = runScript(home, { JEV_HINTS_FILE: file }, `${home}/plan.md`)
      expect(out.trimEnd()).toEndWith('Ничего в репозитории не меняй.')
    }
  })

  test('without JEV_HINTS the prompt is the original one', () => {
    const home = fakeHome()
    const out = runScript(home, {}, `${home}/plan.md`)
    expect(out.trimEnd()).toEndWith('Ничего в репозитории не меняй.')
  })

  test('a missing plan file is reported', () => {
    expect(runScript(fakeHome(), {}, '/nonexistent.md')).toContain('файл плана не найден')
  })
})
