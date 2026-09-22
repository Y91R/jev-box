import { loadConfig, type Provider } from '../hooks/config'
import { ENDPOINTS } from '../hooks/core/request'
import { requirementsOf, stepsOf, type Item } from './extract'
import { askJev, type CliJevConfig } from './jev-client'
import { passagesOf, shortlist } from './passages'
import type { Http, Timer } from './transport'
import * as planSteps from './verifiers/plan-steps'
import * as requirements from './verifiers/requirements'
import * as sources from './verifiers/sources'

export type Io = {
  http: Http
  timer: Timer
  readFile: (path: string) => Promise<string>
  env: (name: 'HOME') => string | undefined
  out: (text: string) => void
}

const PARALLEL = 8
const USAGE = [
  'использование: verify.ts requirements <файл.md> [--json]',
  '               verify.ts sources <файл.md> --source <источник> [--json]',
  '               verify.ts plan-steps <план.md> [--json]',
].join('\n')
// Прокси песочницы Claude отвечает на закрытый хост статусом 403, а не сетевой ошибкой.
const SANDBOX_CODES = new Set(['network', 'http_403'])
const SANDBOX_HINT =
  'вызов, возможно, отрезан песочницей — нужны allowed_domains для api.typesafe.ai и openrouter.ai'

type Failure = { id: string; line: number; code: string }

type Calibration = {
  model: string
  questionVersion: number
  language: string
  providers: readonly string[]
}

// Пороги верны только для ключа калибровки: иначе подсказки читаются как откалиброванные, а они нет.
const calibrationNote = (
  c: Calibration,
  model: string | undefined,
  provider: Provider | undefined,
): string | undefined =>
  model === c.model && provider !== undefined && c.providers.includes(provider)
    ? undefined
    : `пороги откалиброваны для ${c.model} / ${c.providers.join(', ')}, ответ от ${model ?? 'неизвестной модели'} / ${provider ?? 'неизвестного провайдера'}`

type Common = {
  skipped?: string
  hint?: string
  file: string
  model?: string
  calibration?: string
  questionVersion: number
  language: 'ru'
  provider?: Provider
  limitations: string[]
  checked: number
  failures: Failure[]
}

type RequirementsReport = Common & {
  findings: requirements.Finding[]
  measurements: requirements.Measurement[]
}
type SourcesReport = Common & { source: string; findings: sources.Finding[] }
type PlanStepsReport = Common & {
  findings: planSteps.Finding[]
  measurements: { id: string; line: number; values: Record<string, number> }[]
}

class Skip {
  constructor(readonly code: string) {}
}

async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

const skipped = (code: string, file: string, questionVersion: number, limitations: string[]): Common => ({
  skipped: code,
  ...(SANDBOX_CODES.has(code) ? { hint: SANDBOX_HINT } : {}),
  file,
  questionVersion,
  language: 'ru',
  limitations,
  checked: 0,
  failures: [],
})

async function jevOf(io: Io): Promise<{ jev: CliJevConfig; provider: Provider }> {
  const loaded = await loadConfig({
    env: { get: async () => io.env('HOME') },
    fs: { read: io.readFile },
  })
  if (!loaded.ok) throw new Skip(`config_rule_${loaded.rule}`)
  const { config } = loaded
  const section = config[config.provider]
  return {
    provider: config.provider,
    jev: {
      url: ENDPOINTS[config.provider],
      apiKey: section.apiKey ?? '',
      jevModel: section.model,
      timeoutMs: config.timeoutMs,
    },
  }
}

async function readOrSkip(io: Io, path: string, code: string): Promise<string> {
  try {
    return await io.readFile(path)
  } catch {
    throw new Skip(code)
  }
}

async function itemsOf(io: Io, file: string): Promise<Item[]> {
  const items = requirementsOf(await readOrSkip(io, file, 'no_document'))
  if (items.length === 0) throw new Skip('no_requirements')
  return items
}

const byZoneThenLine = <F extends { zone: string; line: number }>(a: F, b: F) =>
  a.zone === b.zone ? a.line - b.line : a.zone === 'flag' ? -1 : 1

async function verifyRequirements(io: Io, file: string): Promise<RequirementsReport> {
  const { jev, provider } = await jevOf(io)
  const items = await itemsOf(io, file)
  const outcomes = await mapLimited(items, PARALLEL, async (item) => ({
    item,
    reply: await askJev(io, jev, item.text, requirements.QUESTIONS),
  }))

  const failures: Failure[] = []
  const findings: requirements.Finding[] = []
  const measurements: requirements.Measurement[] = []
  let model: string | undefined
  for (const { item, reply } of outcomes) {
    if (!reply.ok) {
      failures.push({ id: item.id, line: item.line, code: reply.fail })
      continue
    }
    model ??= reply.jevModel
    findings.push(...requirements.findingsOf(item, reply.answers))
    measurements.push(requirements.measurementOf(item, reply.answers))
  }
  if (failures.length === items.length) throw new Skip(failures[0]!.code)

  const note = calibrationNote(requirements.CALIBRATION, model, provider)
  return {
    file,
    ...(model === undefined ? {} : { model }),
    questionVersion: requirements.QUESTION_VERSION,
    language: 'ru',
    provider,
    ...(note === undefined ? {} : { calibration: note }),
    limitations: requirements.LIMITATIONS,
    checked: items.length,
    failures,
    findings: findings.sort(byZoneThenLine),
    measurements,
  }
}

async function verifySources(io: Io, file: string, source: string | undefined): Promise<SourcesReport> {
  if (source === undefined) throw new Skip('no_source')
  const { jev, provider } = await jevOf(io)
  const items = await itemsOf(io, file)
  const passages = passagesOf(await readOrSkip(io, source, 'no_source'))
  if (passages.length === 0) throw new Skip('no_source')

  const outcomes = await mapLimited(items, PARALLEL, async (item) => {
    const locateQs = sources.locateQuestions(shortlist(item.text, passages))
    const located = await askJev(io, jev, { requirement: item.text }, locateQs)
    if (!located.ok) return { item, fail: located.fail }
    const choice = located.answers.locate.choice
    const passage = passages.find((p) => p.id === choice)
    if (choice === sources.NONE || passage === undefined) {
      return { item, model: located.jevModel, findings: sources.findingsOf(item, located.answers, undefined, passages) }
    }
    const relation = await askJev(io, jev, { claim: item.text, section: sources.passageText(passage) }, sources.RELATION_QUESTIONS)
    if (!relation.ok) return { item, fail: relation.fail }
    return {
      item,
      model: located.jevModel,
      findings: sources.findingsOf(item, located.answers, relation.answers, passages),
    }
  })

  const failures: Failure[] = []
  const findings: sources.Finding[] = []
  let model: string | undefined
  for (const o of outcomes) {
    if (o.fail !== undefined) {
      failures.push({ id: o.item.id, line: o.item.line, code: o.fail })
      continue
    }
    model ??= o.model
    findings.push(...o.findings)
  }
  if (failures.length === items.length) throw new Skip(failures[0]!.code)

  return {
    file,
    source,
    ...(model === undefined ? {} : { model }),
    questionVersion: sources.QUESTION_VERSION,
    language: 'ru',
    provider,
    limitations: sources.LIMITATIONS,
    checked: items.length,
    failures,
    findings: findings.sort(byZoneThenLine),
  }
}

// Пометки кода (нет проверки, нет путей) от Jev не зависят: при любом его отказе они остаются в выводе.
async function verifyPlanSteps(io: Io, file: string): Promise<PlanStepsReport> {
  const steps = stepsOf(await readOrSkip(io, file, 'no_document'))
  if (steps.length === 0) throw new Skip('no_steps')
  const codeFindings = steps.flatMap((step) => planSteps.codeFindingsOf(step))
  const withoutJev = (code: string): PlanStepsReport => ({
    ...skipped(code, file, planSteps.QUESTION_VERSION, planSteps.LIMITATIONS),
    checked: steps.length,
    findings: codeFindings,
    measurements: [],
  })

  let jevConfig: Awaited<ReturnType<typeof jevOf>>
  try {
    jevConfig = await jevOf(io)
  } catch (e) {
    if (e instanceof Skip) return withoutJev(e.code)
    throw e
  }
  const { jev, provider } = jevConfig
  const outcomes = await mapLimited(steps, PARALLEL, async (step) => ({
    step,
    reply: await askJev(io, jev, planSteps.stateOf(step), planSteps.questionsFor(step)),
  }))

  const failures: Failure[] = []
  const findings: planSteps.Finding[] = [...codeFindings]
  const measurements: PlanStepsReport['measurements'] = []
  let model: string | undefined
  for (const { step, reply } of outcomes) {
    if (!reply.ok) {
      failures.push({ id: step.id, line: step.line, code: reply.fail })
      continue
    }
    model ??= reply.jevModel
    findings.push(...planSteps.findingsOf(step, reply.answers))
    measurements.push({
      id: step.id,
      line: step.line,
      values: Object.fromEntries(Object.entries(reply.answers).map(([k, a]) => [k, a.noul])),
    })
  }
  if (failures.length === steps.length) return withoutJev(failures[0]!.code)

  const note = calibrationNote(planSteps.CALIBRATION, model, provider)
  return {
    file,
    ...(model === undefined ? {} : { model }),
    questionVersion: planSteps.QUESTION_VERSION,
    language: 'ru',
    provider,
    ...(note === undefined ? {} : { calibration: note }),
    limitations: planSteps.LIMITATIONS,
    checked: steps.length,
    failures,
    findings: findings.sort(byZoneThenLine),
    measurements,
  }
}

const headerOf = (r: Common, what: string, counted = 'требований'): string[] => [
  `Подсказки Jev по ${r.file} (${what}): проверено ${counted} — ${r.checked}, отказов — ${r.failures.length}.`,
  `Модель ${r.model ?? 'неизвестна'}, провайдер ${r.provider}, версия вопросов ${r.questionVersion}, язык ${r.language}.`,
  `Ограничения: ${r.limitations.join('; ')}. Пометка — повод проверить, а не находка.`,
  ...(r.calibration === undefined ? [] : [`Внимание: ${r.calibration}.`]),
  '',
]

const failuresOf = (r: Common): string[] =>
  r.failures.map((f) => `Отказ по ${f.id} (${r.file}:${f.line}): ${f.code}`)

function requirementsMarkdown(r: RequirementsReport): string {
  const lines = headerOf(r, 'формулировки')
  if (r.findings.length === 0) lines.push('Пометок нет.')
  else {
    lines.push('| место | требование | сигнал | значение | зона |', '|---|---|---|---|---|')
    for (const f of r.findings) {
      lines.push(`| ${r.file}:${f.line} | ${f.id} | ${f.signal} | ${f.value.toFixed(2)} | ${f.zone} |`)
    }
  }
  return [...lines, ...failuresOf(r)].join('\n')
}

function sourcesMarkdown(r: SourcesReport): string {
  const lines = headerOf(r, `сверка с ${r.source}`)
  if (r.findings.length === 0) lines.push('Пометок нет.')
  else {
    lines.push('| место | требование | сигнал | уверенность | зона | фрагмент источника |', '|---|---|---|---|---|---|')
    for (const f of r.findings) {
      const conf = f.confidence === undefined ? '—' : f.confidence.toFixed(2)
      const where = f.passage === undefined ? '—' : `${r.source}:${f.passage.line}`
      lines.push(`| ${r.file}:${f.line} | ${f.id} | ${f.signal} | ${conf} | ${f.zone} | ${where} |`)
    }
  }
  return [...lines, ...failuresOf(r)].join('\n')
}

function planStepsMarkdown(r: PlanStepsReport): string {
  if (r.skipped !== undefined) {
    if (r.findings.length === 0) return skipLine(r)
    const rows = r.findings.map((f) => `| ${r.file}:${f.line} | ${f.id} | ${f.signal} | код | ${f.zone} |`)
    return [skipLine(r), '', 'Пометки кода (без Jev):', '', '| место | шаг | сигнал | значение | зона |', '|---|---|---|---|---|', ...rows].join('\n')
  }
  const lines = headerOf(r, 'шаги плана', 'шагов')
  if (r.findings.length === 0) lines.push('Пометок нет.')
  else {
    lines.push('| место | шаг | сигнал | значение | зона |', '|---|---|---|---|---|')
    for (const f of r.findings) {
      const value = f.value === undefined ? 'код' : f.value.toFixed(2)
      lines.push(`| ${r.file}:${f.line} | ${f.id} | ${f.signal} | ${value} | ${f.zone} |`)
    }
  }
  return [...lines, ...failuresOf(r)].join('\n')
}

const skipLine = (r: Common) =>
  `Слой Jev пропущен: ${r.skipped}${r.hint === undefined ? '' : ` (${r.hint})`}`

export async function run(io: Io, argv: readonly string[]): Promise<number> {
  const [command, file, ...rest] = argv
  const json = rest.includes('--json')
  const at = rest.indexOf('--source')
  const source = at === -1 ? undefined : rest[at + 1]
  if (file === undefined || !['requirements', 'sources', 'plan-steps'].includes(command ?? '')) {
    io.out(USAGE)
    return 2
  }

  const print = <R>(r: R, markdown: (r: R) => string) =>
    io.out(json ? JSON.stringify(r, null, 2) : markdown(r))
  try {
    if (command === 'requirements') print(await verifyRequirements(io, file), requirementsMarkdown)
    else if (command === 'sources') print(await verifySources(io, file, source), sourcesMarkdown)
    else print(await verifyPlanSteps(io, file), planStepsMarkdown)
  } catch (e) {
    if (!(e instanceof Skip)) throw e
    const [version, limitations] =
      command === 'requirements'
        ? [requirements.QUESTION_VERSION, requirements.LIMITATIONS]
        : command === 'sources'
          ? [sources.QUESTION_VERSION, sources.LIMITATIONS]
          : [planSteps.QUESTION_VERSION, planSteps.LIMITATIONS]
    print(skipped(e.code, file, version, limitations), skipLine)
  }
  return 0
}
