import { describe, expect, test } from 'bun:test'
import { run, type Io } from '../../cli/run'
import type { Http } from '../../cli/transport'

const root = `${import.meta.dir}/../..`
const HOME = '/home/test'
const CONFIG_PATH = `${HOME}/.config/jev-box/config.json`

const config = JSON.stringify({
  provider: 'typesafe',
  typesafe: { apiKey: 'secret-key', model: 'jev-latest' },
  openrouter: { model: '~typesafe/jev-latest' },
})

const recorded = (name: string) =>
  Bun.file(`${root}/tests/fixtures/requirements/${name}.json`).json()

const setup = (files: Record<string, string>, http: Http) => {
  const out: string[] = []
  const io: Io = {
    http,
    timer: () => ({ elapsed: new Promise(() => {}), cancel: () => {} }),
    readFile: async (path) => {
      const text = files[path]
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    env: () => HOME,
    out: (t) => out.push(t),
  }
  return { io, out }
}

const replying = (status: number, body: unknown): Http => async () => ({
  status,
  text: JSON.stringify(body),
})

describe('run requirements', () => {
  test('one request per requirement, at most 8 in flight', async () => {
    const st = await Bun.file(`${root}/tests/fixtures/requirements/model_choice.md`).text()
    const { response } = await recorded('FR-13')
    let calls = 0
    let inFlight = 0
    let peak = 0
    const http: Http = async () => {
      calls++
      peak = Math.max(peak, ++inFlight)
      await new Promise((r) => setTimeout(r, 1))
      inFlight--
      return { status: 200, text: JSON.stringify(response) }
    }
    const { io, out } = setup({ [CONFIG_PATH]: config, 'st.md': st }, http)
    expect(await run(io, ['requirements', 'st.md', '--json'])).toBe(0)
    expect(calls).toBe(29)
    expect(peak).toBeLessThanOrEqual(8)
    expect(peak).toBeGreaterThan(1)
    const report = JSON.parse(out[0]!)
    expect(report.checked).toBe(29)
    expect(report.model).toBe('jev-1.13.0')
    expect(report.questionVersion).toBe(1)
  })

  test('flagged requirements are listed with file:line', async () => {
    const { response } = await recorded('bad-vague')
    const md = '# СТ\n\n- **FR-1.** Система должна быстро отвечать.\n- **FR-2.** Второе.\n'
    const { io, out } = setup({ [CONFIG_PATH]: config, 'st.md': md }, replying(200, response))
    await run(io, ['requirements', 'st.md'])
    expect(out[0]).toContain('| st.md:3 | FR-1 | vague_word | 0.97 | flag |')
    expect(out[0]).toContain('| st.md:4 | FR-2 | vague_word | 0.97 | flag |')
    expect(out[0]).toContain('пороги откалиброваны предварительно: jev-1.13.0')
  })

  test('a model outside the calibration key is called out in the header', async () => {
    const { response } = await recorded('FR-13')
    const md = '- **FR-1.** A.\n'
    const other = { ...response, model: 'jev-1.14.0' }
    const { io, out } = setup({ [CONFIG_PATH]: config, 'st.md': md }, replying(200, other))
    await run(io, ['requirements', 'st.md'])
    expect(out[0]).toContain('Внимание: пороги откалиброваны для jev-1.13.0 / typesafe, ответ от jev-1.14.0 / typesafe.')

    const same = setup({ [CONFIG_PATH]: config, 'st.md': md }, replying(200, response))
    await run(same.io, ['requirements', 'st.md'])
    expect(same.out[0]).not.toContain('Внимание:')
  })

  test('every request refused: one skipped line and exit 0', async () => {
    const { io, out } = setup(
      { [CONFIG_PATH]: config, 'st.md': '- **FR-1.** A.\n- **FR-2.** B.' },
      replying(401, { error: 'bad key secret-key' }),
    )
    expect(await run(io, ['requirements', 'st.md'])).toBe(0)
    expect(out).toEqual(['Слой Jev пропущен: http_401'])
  })

  test('network failure and the sandbox proxy 403 both explain the sandbox', async () => {
    const cases: [Http, string][] = [
      [() => Promise.reject(new Error('blocked')), 'network'],
      [replying(403, 'Forbidden'), 'http_403'],
    ]
    for (const [http, code] of cases) {
      const { io, out } = setup({ [CONFIG_PATH]: config, 'st.md': '- **FR-1.** A.' }, http)
      await run(io, ['requirements', 'st.md'])
      expect(out[0]).toStartWith(`Слой Jev пропущен: ${code} (`)
      expect(out[0]).toContain('allowed_domains')
    }
  })

  test('no config, no document, no requirements', async () => {
    const http = replying(200, {})
    const noConfig = setup({ 'st.md': '- **FR-1.** A.' }, http)
    await run(noConfig.io, ['requirements', 'st.md'])
    expect(noConfig.out).toEqual(['Слой Jev пропущен: config_rule_1'])

    const noDoc = setup({ [CONFIG_PATH]: config }, http)
    await run(noDoc.io, ['requirements', 'missing.md'])
    expect(noDoc.out).toEqual(['Слой Jev пропущен: no_document'])

    const empty = setup({ [CONFIG_PATH]: config, 'st.md': '# Пусто' }, http)
    await run(empty.io, ['requirements', 'st.md'])
    expect(empty.out).toEqual(['Слой Jev пропущен: no_requirements'])
  })

  test('a failure on one requirement does not stop the others', async () => {
    const { response } = await recorded('bad-vague')
    let n = 0
    const http: Http = async () =>
      ++n === 1 ? { status: 500, text: '' } : { status: 200, text: JSON.stringify(response) }
    const md = '- **FR-1.** A.\n- **FR-2.** B.'
    const { io, out } = setup({ [CONFIG_PATH]: config, 'st.md': md }, http)
    await run(io, ['requirements', 'st.md'])
    expect(out[0]).toContain('отказов — 1')
    expect(out[0]).toContain('Отказ по FR-1 (st.md:1): http_500')
    expect(out[0]).toContain('| st.md:2 | FR-2 | vague_word')
  })

  test('the api key never reaches the output', async () => {
    for (const http of [replying(401, { error: 'secret-key' }), replying(200, (await recorded('FR-1')).response)]) {
      const { io, out } = setup({ [CONFIG_PATH]: config, 'st.md': '- **FR-1.** A.' }, http)
      await run(io, ['requirements', 'st.md', '--json'])
      expect(JSON.stringify(out)).not.toContain('secret-key')
    }
  })

  test('unknown command prints usage and exits 2', async () => {
    const { io, out } = setup({}, replying(200, {}))
    expect(await run(io, ['plan', 'x.md'])).toBe(2)
    expect(out[0]).toStartWith('использование:')
  })
})

describe('run requirements --json', () => {
  test('measurements keep every signal for calibration, findings only the hinted ones', async () => {
    const { response } = await recorded('bad-several')
    const { io, out } = setup({ [CONFIG_PATH]: config, 'st.md': '- **FR-1.** A.' }, replying(200, response))
    await run(io, ['requirements', 'st.md', '--json'])
    const report = JSON.parse(out[0]!)
    expect(report.findings).toEqual([])
    expect(report.measurements).toEqual([
      { id: 'FR-1', line: 1, values: { observable: 0.87, several_rules: 0.92, vague_word: 0.08 } },
    ])
  })
})

describe('run sources', () => {
  const dir = `${root}/tests/fixtures/sources`
  const files = async () => ({
    [CONFIG_PATH]: config,
    'artifact.md': await Bun.file(`${dir}/artifact.md`).text(),
    'source.md': await Bun.file(`${dir}/source.md`).text(),
  })
  const recordedHttp = async () => {
    const byText = new Map<string, { locate: any; relation: any }>()
    for (const id of ['FR-1', 'FR-2', 'FR-3', 'FR-4', 'FR-5', 'FR-6']) {
      const f = await Bun.file(`${dir}/${id}.json`).json()
      byText.set(f.locate.state.requirement, f)
    }
    const sent: string[] = []
    const http: Http = async (_url, init) => {
      const body = JSON.parse(init.body)
      const key = body.state.requirement ?? body.state.claim
      const f = byText.get(key)!
      const kind = 'locate' in body.questions ? 'locate' : 'relation'
      sent.push(kind)
      return { status: 200, text: JSON.stringify(f[kind].response) }
    }
    return { http, sent }
  }

  test('flags the contradicting and the invented requirements, with the source passage', async () => {
    const { http } = await recordedHttp()
    const { io, out } = setup(await files(), http)
    expect(await run(io, ['sources', 'artifact.md', '--source', 'source.md'])).toBe(0)
    expect(out[0]).toContain('проверено требований — 6, отказов — 0')
    expect(out[0]).toContain('потерянные ограничения источника не ищутся')
    const rows = out[0]!.split('\n').filter((l) => l.startsWith('| artifact.md:'))
    expect(rows).toEqual([
      '| artifact.md:8 | FR-4 | contradicts | 1.00 | flag | source.md:5 |',
      '| artifact.md:9 | FR-5 | contradicts | 0.99 | flag | source.md:3 |',
      '| artifact.md:10 | FR-6 | unsupported | 0.85 | flag | — |',
    ])
  })

  test('no verdict request when no passage was found', async () => {
    const { http, sent } = await recordedHttp()
    const { io } = setup(await files(), http)
    await run(io, ['sources', 'artifact.md', '--source', 'source.md'])
    expect(sent.filter((k) => k === 'locate')).toHaveLength(6)
    expect(sent.filter((k) => k === 'relation')).toHaveLength(5)
  })

  test('without a readable source the layer is skipped', async () => {
    const { http } = await recordedHttp()
    for (const argv of [['sources', 'artifact.md'], ['sources', 'artifact.md', '--source', 'missing.md']]) {
      const { io, out } = setup(await files(), http)
      expect(await run(io, argv)).toBe(0)
      expect(out).toEqual(['Слой Jev пропущен: no_source'])
    }
  })
})

describe('run plan-steps', () => {
  const fx = `${root}/tests/fixtures`
  const recordedHttp = async () => {
    const plan = await Bun.file(`${fx}/plans/steps-heading.md`).text()
    const { stepsOf } = await import('../../cli/extract')
    const byStep = new Map<string, unknown>()
    for (const step of stepsOf(plan)) {
      const f = await Bun.file(`${fx}/plan-steps/steps-heading-${step.id.replace(' ', '-')}.json`).json()
      byStep.set(step.text, f.response)
    }
    const http: Http = async (_url, init) => ({
      status: 200,
      text: JSON.stringify(byStep.get(JSON.parse(init.body).state.step)),
    })
    return { plan, http }
  }

  test('flags the spoiled steps, code flags marked as code', async () => {
    const { plan, http } = await recordedHttp()
    const { io, out } = setup({ [CONFIG_PATH]: config, 'plan.md': plan }, http)
    expect(await run(io, ['plan-steps', 'plan.md'])).toBe(0)
    expect(out[0]).toContain('проверено шагов — 5, отказов — 0')
    const flags = out[0]!.split('\n').filter((l) => l.endsWith('| flag |'))
    expect(flags).toEqual([
      '| plan.md:26 | Шаг 3 | observable_check | 0.06 | flag |',
      '| plan.md:34 | Шаг 4 | observable_check | 0.14 | flag |',
      '| plan.md:34 | Шаг 4 | manual_action | 0.99 | flag |',
      '| plan.md:49 | Шаг 5 | no_check | код | flag |',
      '| plan.md:49 | Шаг 5 | unverified_behavior | 0.92 | flag |',
    ])
  })

  test('when Jev is unavailable the code flags stay, under the skipped line', async () => {
    const md = '## Шаг 1. A\n\nФайлы: `a/b.ts`.\n\n**Проверка:** `bun test`.\n\n## Шаг 2. B\n\nБез файлов.\n'
    const cases: [Record<string, string>, Http, string][] = [
      [{ [CONFIG_PATH]: config, 'plan.md': md }, replying(401, {}), 'http_401'],
      [{ 'plan.md': md }, replying(200, {}), 'config_rule_1'],
      [{ [CONFIG_PATH]: config, 'plan.md': md }, replying(403, 'Forbidden'), 'http_403'],
    ]
    for (const [files, http, code] of cases) {
      const { io, out } = setup(files, http)
      expect(await run(io, ['plan-steps', 'plan.md'])).toBe(0)
      const lines = out[0]!.split('\n')
      expect(lines[0]).toStartWith(`Слой Jev пропущен: ${code}`)
      expect(lines).toContain('| plan.md:7 | Шаг 2 | no_check | код | flag |')
      expect(lines).toContain('| plan.md:7 | Шаг 2 | no_paths | код | flag |')
    }
  })

  test('a plan without steps is skipped', async () => {
    const { io, out } = setup({ [CONFIG_PATH]: config, 'plan.md': '# План\n\nТекст.' }, replying(200, {}))
    expect(await run(io, ['plan-steps', 'plan.md'])).toBe(0)
    expect(out).toEqual(['Слой Jev пропущен: no_steps'])
  })

  test('code flags stay when Jev fails on a step', async () => {
    const md = '## Шаг 1. A\n\nФайлы: `a/b.ts`.\n\n**Проверка:** `bun test`.\n\n## Шаг 2. B\n\nБез файлов.\n'
    let n = 0
    const http: Http = async () => (++n === 1 ? { status: 200, text: JSON.stringify({ answers: {
      manual_action: { type: 'noul', noul: 0.1 },
      unverified_behavior: { type: 'noul', noul: 0.1 },
      observable_check: { type: 'noul', noul: 0.9 },
    } }) } : { status: 500, text: '' })
    const { io, out } = setup({ [CONFIG_PATH]: config, 'plan.md': md }, http)
    await run(io, ['plan-steps', 'plan.md', '--json'])
    const report = JSON.parse(out[0]!)
    expect(report.failures).toEqual([{ id: 'Шаг 2', line: 7, code: 'http_500' }])
    expect(report.findings.map((f: { signal: string }) => f.signal)).toEqual(['no_check', 'no_paths'])
  })
})

describe('run readability', () => {
  const fixture = () => Bun.file(`${root}/tests/fixtures/typesafe-readability.json`).json()
  const doc = [
    '# Приёмка короба',
    '',
    '## Глоссарий',
    '',
    '- **Короб** — тара с посылками.',
    '',
    '## Сценарий',
    '',
    'Три посылки — три пути: короб едет дальше, а смысл остаётся с нами.',
    '',
    'По FR-8 короб уходит → в ячейку, см. `cli/run.ts:12`.',
    '',
  ].join('\n')

  test('code flags and Jev flags in one table', async () => {
    const { response } = await fixture()
    const { io, out } = setup({ [CONFIG_PATH]: config, 'doc.md': doc }, replying(200, response))
    expect(await run(io, ['readability', 'doc.md'])).toBe(0)
    const lines = out[0]!.split('\n')
    expect(lines).toContain('| место | фрагмент | сигнал | значение | зона |')
    expect(lines).toContain('| doc.md:9 | Три посылки — три пути: короб едет дальше, а смысл остаётся | slogan | 0.95 | flag |')
    expect(lines).toContain('| doc.md:11 | По FR-8 короб уходит → в ячейку, см. `cli/run.ts:12`. | bare_reference | FR-8 | flag |')
    expect(lines).toContain('| doc.md:11 | По FR-8 короб уходит → в ячейку, см. `cli/run.ts:12`. | line_anchor | cli/run.ts:12 | flag |')
    expect(lines).toContain('| doc.md:11 | По FR-8 короб уходит → в ячейку, см. `cli/run.ts:12`. | pictograph | → | flag |')
  })

  test('--plan allows line anchors', async () => {
    const { response } = await fixture()
    const { io, out } = setup({ [CONFIG_PATH]: config, 'doc.md': doc }, replying(200, response))
    await run(io, ['readability', 'doc.md', '--plan'])
    expect(out[0]).not.toContain('line_anchor')
  })

  test('--json keeps code measurements and Jev values, the glossary goes to Jev', async () => {
    const { response } = await fixture()
    const bodies: string[] = []
    const http: Http = async (_url, init) => {
      bodies.push(init.body)
      return { status: 200, text: JSON.stringify(response) }
    }
    const { io, out } = setup({ [CONFIG_PATH]: config, 'doc.md': doc }, http)
    await run(io, ['readability', 'doc.md', '--json'])
    const report = JSON.parse(out[0]!)
    const m = report.measurements.find((x: { line: number }) => x.line === 9)
    expect(m.values.slogan).toBe(0.95)
    expect(m.code).toEqual({ emphasis: 0 })
    expect(JSON.parse(bodies[0]!).state.glossary).toBe('**Короб** — тара с посылками.')
    expect(report.checked).toBe(6)
    expect(report.jevChecked).toBe(3)
  })

  test('when Jev is unavailable the code flags stay under the skipped line', async () => {
    const { io, out } = setup({ [CONFIG_PATH]: config, 'doc.md': doc }, async () => {
      throw new Error('down')
    })
    expect(await run(io, ['readability', 'doc.md'])).toBe(0)
    const lines = out[0]!.split('\n')
    expect(lines[0]).toBe('Слой Jev пропущен: network (вызов, возможно, отрезан песочницей — нужны allowed_domains для api.typesafe.ai и openrouter.ai)')
    expect(lines.some((l) => l.includes('| bare_reference | FR-8 | flag |'))).toBe(true)
  })

  test('skips: no document, no fragments, not Russian; wrong arguments exit 2', async () => {
    const cases: [Record<string, string>, string][] = [
      [{ [CONFIG_PATH]: config }, 'Слой Jev пропущен: no_document'],
      [{ [CONFIG_PATH]: config, 'doc.md': '```\nкод\n```\n' }, 'Слой Jev пропущен: no_fragments'],
      [{ [CONFIG_PATH]: config, 'doc.md': 'The plugin ships skills, see FR-8.\n' }, 'Слой Jev пропущен: not_russian'],
    ]
    for (const [files, first] of cases) {
      const { io, out } = setup(files, replying(200, {}))
      expect(await run(io, ['readability', 'doc.md'])).toBe(0)
      expect(out[0]!.split('\n')[0]).toBe(first)
    }
    const { io, out } = setup({ 'doc.md': 'The plugin ships skills, see FR-8.\n' }, replying(200, {}))
    await run(io, ['readability', 'doc.md'])
    expect(out[0]).toContain('| bare_reference | FR-8 | flag |')
    expect(await run(setup({}, replying(200, {})).io, ['readability'])).toBe(2)
  })

  test('only short fragments: header with zero checked by Jev, no skipped line', async () => {
    const { io, out } = setup({ [CONFIG_PATH]: config, 'doc.md': '# Раздел\n\n- один\n- два\n- три\n' }, replying(200, {}))
    await run(io, ['readability', 'doc.md'])
    expect(out[0]).toStartWith('Подсказки Jev по doc.md (читаемость): проверено фрагментов — 4, из них Jev — 0, отказов — 0.')
    expect(out[0]).toContain('| fragment_list | 3 пункта, до 1 слов | flag |')
  })

  test('a failing fragment is reported, the rest stay', async () => {
    const { response } = await fixture()
    let n = 0
    const http: Http = async () => (++n === 1 ? { status: 500, text: '' } : { status: 200, text: JSON.stringify(response) })
    const { io, out } = setup({ [CONFIG_PATH]: config, 'doc.md': doc }, http)
    await run(io, ['readability', 'doc.md'])
    expect(out[0]).toMatch(/Отказ по doc\.md:\d+: http_500/)
  })

  test('the glossary limitation belongs to one run only', async () => {
    const { response } = await fixture()
    const long = `# СТ\n\n## Глоссарий\n\n- **Термин** — ${'длинное определение '.repeat(1500)}\n\n## Текст\n\nОбычный абзац из нескольких слов.\n`
    const first = setup({ [CONFIG_PATH]: config, 'doc.md': long }, replying(200, response))
    await run(first.io, ['readability', 'doc.md'])
    expect(first.out[0]).toContain('глоссарий не передан: слишком длинный')
    const second = setup({ [CONFIG_PATH]: config, 'doc.md': doc }, replying(200, response))
    await run(second.io, ['readability', 'doc.md'])
    expect(second.out[0]).not.toContain('глоссарий не передан')
  })

  test('an OpenRouter answer is called out against the calibration key', async () => {
    const { response } = await fixture()
    const viaOpenRouter = JSON.stringify({ ...JSON.parse(config), provider: 'openrouter', openrouter: { apiKey: 'k', model: '~typesafe/jev-latest' } })
    const { io, out } = setup({ [CONFIG_PATH]: viaOpenRouter, 'doc.md': doc }, replying(200, response))
    await run(io, ['readability', 'doc.md'])
    expect(out[0]).toContain('Внимание: пороги откалиброваны для jev-1.13.0 / typesafe')
  })
})
