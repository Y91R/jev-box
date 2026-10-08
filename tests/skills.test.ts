import { describe, expect, test } from 'bun:test'
import { readdirSync } from 'node:fs'
import { commonText, firstDifference, upstreamText } from './support/upstream'

const skillsDir = `${import.meta.dir}/../skills`
const names = readdirSync(skillsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
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
    expect(names.sort()).toEqual(['analyst', 'analyst-review', 'plan', 'review-plan'])
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

const upstreamDir = `${import.meta.dir}/fixtures/upstream-skills`
const UPSTREAM_FILES = ['analyst/SKILL.md', 'analyst-review/SKILL.md', 'plan/SKILL.md', 'review-plan/SKILL.md', 'plan.tmpl']

// Скиллы, пересобранные от основного набора: их общий текст обязан совпадать со снимком.
const SYNCED: string[] = ['analyst', 'analyst-review', 'plan', 'review-plan']

describe('snapshot of the upstream skills', () => {
  test('every snapshot file exists and the commit is recorded', async () => {
    for (const f of UPSTREAM_FILES) expect((await Bun.file(`${upstreamDir}/${f}`).text()).length).toBeGreaterThan(0)
    expect(await Bun.file(`${upstreamDir}/COMMIT`).text()).toStartWith('27190ff')
  })

  for (const name of SYNCED) {
    test(`${name}: common text matches the upstream skill`, async () => {
      const { lines, replaced } = commonText(await Bun.file(`${skillsDir}/${name}/SKILL.md`).text())
      const upstream = upstreamText(await Bun.file(`${upstreamDir}/${name}/SKILL.md`).text(), replaced)
      expect(firstDifference(lines, upstream) ?? 'совпадает').toBe('совпадает')
    })
  }

  const live = process.env.UPSTREAM_SKILLS
  const liveTest = live === undefined ? test.skip : test
  liveTest('the snapshot is up to date with UPSTREAM_SKILLS (skipped without the variable)', async () => {
    for (const f of UPSTREAM_FILES) {
      const path = f === 'plan.tmpl' ? `${live}/../internal/review/prompts/plan.tmpl` : `${live}/${f}`
      const same = (await Bun.file(path).text()) === (await Bun.file(`${upstreamDir}/${f}`).text())
      expect(same ? 'совпадает' : `снимок устарел: ${f}`).toBe('совпадает')
    }
  })
})

describe('codex transport in the review skills', () => {
  for (const name of ['analyst-review', 'review-plan']) {
    test(`${name} runs codex through blue-tape external-review, without peer-chat and old scripts`, async () => {
      const t = await Bun.file(`${skillsDir}/${name}/SKILL.md`).text()
      expect(t).toContain('blue-tape external-review')
      for (const old of ['peer-chat', 'external-review.sh', 'review-plan.sh', 'JEV_HINTS_FILE']) expect(t).not.toContain(old)
    })
  }
})

describe('review-plan task for codex', () => {
  test('every plugin skill is synced with the snapshot', () => {
    expect([...SYNCED].sort()).toEqual([...names].sort())
  })

  test('the task text is the upstream plan.tmpl with the plan path placeholder', async () => {
    const tmpl = (await Bun.file(`${upstreamDir}/plan.tmpl`).text()).trim()
    const skill = await Bun.file(`${skillsDir}/review-plan/SKILL.md`).text()
    expect(skill).toContain(tmpl.replace('{{.PlanFile}}', '<абсолютный путь к плану>'))
  })
})

describe('readability pass in the review skills', () => {
  for (const [name, call] of [
    ['analyst-review', 'verify.ts readability <DOC>'],
    ['review-plan', 'verify.ts readability <путь-к-плану.md> --plan'],
  ] as const) {
    test(`${name} runs «${call}» inside a Jev block and reports «Читаемость»`, async () => {
      const t = await Bun.file(`${skillsDir}/${name}/SKILL.md`).text()
      const { lines } = commonText(t)
      expect(t).toContain(call)
      expect(lines.join('\n')).not.toContain('readability')
      expect(t).toContain('Читаемость: N пометок, подтвердилось M')
    })
  }
})
