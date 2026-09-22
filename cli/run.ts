import { loadConfig } from '../hooks/config'
import { ENDPOINTS } from '../hooks/core/request'
import { requirementsOf, type Item } from './extract'
import { askJev, type CliJevConfig } from './jev-client'
import type { Http, Timer } from './transport'
import {
  findingsOf,
  LIMITATIONS,
  measurementOf,
  QUESTION_VERSION,
  QUESTIONS,
  type Finding,
  type Measurement,
} from './verifiers/requirements'

export type Io = {
  http: Http
  timer: Timer
  readFile: (path: string) => Promise<string>
  env: (name: 'HOME') => string | undefined
  out: (text: string) => void
}

const PARALLEL = 8
const USAGE = 'использование: verify.ts requirements <файл.md> [--json]'
// Прокси песочницы Claude отвечает на закрытый хост статусом 403, а не сетевой ошибкой.
const SANDBOX_CODES = new Set(['network', 'http_403'])
const SANDBOX_HINT =
  'вызов, возможно, отрезан песочницей — нужны allowed_domains для api.typesafe.ai и openrouter.ai'

type Failure = { id: string; line: number; code: string }

type Report = {
  skipped?: string
  hint?: string
  file: string
  model?: string
  questionVersion: number
  language: 'ru'
  provider?: string
  limitations: string[]
  checked: number
  failures: Failure[]
  findings: Finding[]
  measurements: Measurement[]
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

const skip = (file: string, code: string): Report => ({
  skipped: code,
  ...(SANDBOX_CODES.has(code) ? { hint: SANDBOX_HINT } : {}),
  file,
  questionVersion: QUESTION_VERSION,
  language: 'ru',
  limitations: LIMITATIONS,
  checked: 0,
  failures: [],
  findings: [],
  measurements: [],
})

async function verifyRequirements(io: Io, file: string): Promise<Report> {
  const loaded = await loadConfig({
    env: { get: async () => io.env('HOME') },
    fs: { read: io.readFile },
  })
  if (!loaded.ok) return skip(file, `config_rule_${loaded.rule}`)
  const config = loaded.config

  let markdown: string
  try {
    markdown = await io.readFile(file)
  } catch {
    return skip(file, 'no_document')
  }
  const items = requirementsOf(markdown)
  if (items.length === 0) return skip(file, 'no_requirements')

  const section = config[config.provider]
  const jev: CliJevConfig = {
    url: ENDPOINTS[config.provider],
    apiKey: section.apiKey ?? '',
    jevModel: section.model,
    timeoutMs: config.timeoutMs,
  }

  const outcomes = await mapLimited(items, PARALLEL, async (item: Item) => ({
    item,
    reply: await askJev(io, jev, item.text, QUESTIONS),
  }))

  const failures: Failure[] = []
  const findings: Finding[] = []
  const measurements: Measurement[] = []
  let model: string | undefined
  for (const { item, reply } of outcomes) {
    if (reply.ok) {
      model ??= reply.jevModel
      findings.push(...findingsOf(item, reply.answers))
      measurements.push(measurementOf(item, reply.answers))
    } else {
      failures.push({ id: item.id, line: item.line, code: reply.fail })
    }
  }
  if (failures.length === items.length) return skip(file, failures[0]!.code)

  return {
    file,
    ...(model === undefined ? {} : { model }),
    questionVersion: QUESTION_VERSION,
    language: 'ru',
    provider: config.provider,
    limitations: LIMITATIONS,
    checked: items.length,
    failures,
    findings: findings.sort(
      (a, b) => (a.zone === b.zone ? a.line - b.line : a.zone === 'flag' ? -1 : 1),
    ),
    measurements,
  }
}

function markdownOf(r: Report): string {
  if (r.skipped !== undefined) {
    return `Слой Jev пропущен: ${r.skipped}${r.hint === undefined ? '' : ` (${r.hint})`}`
  }
  const lines = [
    `Подсказки Jev по ${r.file}: проверено требований — ${r.checked}, отказов — ${r.failures.length}.`,
    `Модель ${r.model ?? 'неизвестна'}, провайдер ${r.provider}, версия вопросов ${r.questionVersion}, язык ${r.language}.`,
    `Ограничения: ${r.limitations.join('; ')}. Пометка — повод проверить, а не находка.`,
    '',
  ]
  if (r.findings.length === 0) {
    lines.push('Пометок нет.')
  } else {
    lines.push('| место | требование | сигнал | значение | зона |', '|---|---|---|---|---|')
    for (const f of r.findings) {
      lines.push(`| ${r.file}:${f.line} | ${f.id} | ${f.signal} | ${f.value.toFixed(2)} | ${f.zone} |`)
    }
  }
  for (const f of r.failures) lines.push(`Отказ по ${f.id} (${r.file}:${f.line}): ${f.code}`)
  return lines.join('\n')
}

export async function run(io: Io, argv: readonly string[]): Promise<number> {
  const [command, file, ...flags] = argv
  if (command !== 'requirements' || file === undefined) {
    io.out(USAGE)
    return 2
  }
  const report = await verifyRequirements(io, file)
  io.out(flags.includes('--json') ? JSON.stringify(report, null, 2) : markdownOf(report))
  return 0
}
