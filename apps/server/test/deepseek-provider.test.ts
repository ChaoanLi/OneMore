import { describe, expect, it } from 'vitest'
import { DeepSeekDraftProvider } from '../src/ai/providers'

const context = { now: new Date('2026-10-24T03:00:00Z'), timezone: 'America/Chicago', locale: 'en' as const }
const draft = { options: [{ gameKey: 'boardgame', name: 'Board games' }], when: 'tomorrow' }

// The external API accepts current model IDs and needs non-thinking mode for
// a small JSON-only output budget. A legacy ID or missing switch must fail.
describe('DeepSeek current Chat Completions contract', () => {
  it.each([
    { requested: undefined, expected: 'deepseek-flash' },
    { requested: 'deepseek-v4-pro', expected: 'deepseek-v4-pro' },
  ])('returns a validated draft with model $expected and no reasoning budget', async ({ requested, expected }) => {
    let endpoint = ''
    let body: any
    const api: typeof fetch = async (url, init) => {
      endpoint = String(url)
      body = JSON.parse(String(init?.body))
      return new Response(JSON.stringify({
        id: 'synthetic-completion', object: 'chat.completion', created: 1792800000,
        model: expected,
        choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(draft) } }],
        usage: { prompt_tokens: 100, completion_tokens: 40, total_tokens: 140 },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    const provider = new DeepSeekDraftProvider('synthetic-test-key', 'https://example.invalid', requested, 1000, api)
    await expect(provider.parse('Board games tomorrow', context)).resolves.toMatchObject(draft)
    expect(endpoint).toBe('https://example.invalid/chat/completions')
    expect(body.model).toBe(expected)
    expect(body.thinking).toEqual({ type: 'disabled' })
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.max_tokens).toBeLessThanOrEqual(1000)
    expect(body.messages[0].content.toLowerCase()).toContain('json')
  })
})
