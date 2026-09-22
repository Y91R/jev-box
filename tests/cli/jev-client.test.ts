import { describe, expect, test } from 'bun:test'
import { askJev } from '../../cli/jev-client'
import type { Http } from '../../cli/transport'
import type { NoulQuestion, ScoreQuestion } from '../../hooks/core/questions'

const questions = {
  measurable: {
    type: 'noul',
    instructions: 'Does the requirement state a measurable threshold?',
  } as NoulQuestion,
  specificity: {
    type: 'score',
    instructions: 'How specific is the requirement?',
    criteria: ['Vague', 'Partly specific', 'Fully specific'],
  } as ScoreQuestion,
}

const config = {
  url: 'https://api.typesafe.ai/v1/systemone',
  apiKey: 'k',
  jevModel: 'jev-latest',
  timeoutMs: 3000,
}

const never = () => new Promise<void>(() => {})

describe('askJev', () => {
  test('runs the core without the engine: request out, typed answers back', async () => {
    const text = await Bun.file(`${import.meta.dir}/../fixtures/typesafe-noul-score.json`).text()
    const sent: { url: string; body: unknown }[] = []
    const http: Http = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) })
      return { status: 200, text }
    }
    const r = await askJev({ http, sleep: never }, config, 'Система должна быстро возвращать деньги.', questions)
    expect(sent).toEqual([
      {
        url: config.url,
        body: { model: 'jev-latest', state: 'Система должна быстро возвращать деньги.', questions },
      },
    ])
    if (!r.ok) throw new Error(JSON.stringify(r))
    expect(r.answers.measurable.noul).toBe(0.08)
    expect(r.answers.specificity.confidence).toBe(0.86)
  })

  test('transport failures come back as they are', async () => {
    const http: Http = () => Promise.reject(new Error('down'))
    expect(await askJev({ http, sleep: never }, config, 's', questions)).toEqual({
      ok: false,
      fail: 'network',
    })
  })
})
