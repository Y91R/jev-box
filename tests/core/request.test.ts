import { describe, expect, test } from 'bun:test'
import { buildJevRequest } from '../../hooks/core/request'

const questions = {
  urgent: { type: 'noul' as const, instructions: 'Is it urgent?' },
  level: { type: 'score' as const, instructions: 'How urgent?', criteria: ['Low', 'High'] },
}

describe('buildJevRequest', () => {
  test('questions go into the body as they are', () => {
    const req = buildJevRequest({
      url: 'https://example.test/decide',
      apiKey: 'k',
      jevModel: 'jev-latest',
      state: 'help',
      questions,
    })
    expect(req.url).toBe('https://example.test/decide')
    expect(req.init.method).toBe('POST')
    expect(JSON.parse(req.init.body)).toEqual({ model: 'jev-latest', state: 'help', questions })
  })

  test('bearer key and JSON content type', () => {
    const req = buildJevRequest({ url: 'u', apiKey: 'k', jevModel: 'm', state: 's', questions })
    expect(req.init.headers).toEqual({
      Authorization: 'Bearer k',
      'Content-Type': 'application/json',
    })
  })

  test('an empty key still builds the request', () => {
    const req = buildJevRequest({ url: 'u', apiKey: '', jevModel: 'm', state: 's', questions })
    expect(req.init.headers.Authorization).toBe('Bearer ')
  })
})
