import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'

const skillsDir = `${import.meta.dir}/../skills`
const names = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)

const frontmatterOf = (text: string): Record<string, string> => {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text)
  if (!m) return {}
  return Object.fromEntries(
    m[1]!.split('\n').map((line) => {
      const i = line.indexOf(':')
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()]
    }),
  )
}

describe('plugin skills', () => {
  test('the plugin ships skills', () => {
    expect(names).toContain('analyst-reviewer')
    expect(names).toContain('system-analyst')
  })

  for (const name of names) {
    describe(name, () => {
      const text = () => Bun.file(`${skillsDir}/${name}/SKILL.md`).text()

      test('frontmatter names the skill after its directory and describes it', async () => {
        const fm = frontmatterOf(await text())
        expect(fm.name).toBe(name)
        expect(fm.description?.length ?? 0).toBeGreaterThan(20)
        expect(fm.description).toContain('Jev')
      })

      test('calls the CLI from the plugin root and opens the sandbox for the providers', async () => {
        const t = await text()
        expect(t).toContain('${CLAUDE_PLUGIN_ROOT}/cli/verify.ts')
        expect(t).toContain('allowed_domains: ["api.typesafe.ai", "openrouter.ai"]')
      })

      test('falls back past the sandbox on network and on the proxy 403', async () => {
        const t = await text()
        expect(t).toContain('http_403')
        expect(t).toContain('dangerouslyDisableSandbox: true')
      })
    })
  }
})
