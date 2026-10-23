import {
  aiDraftSchema,
  buildDraftSystemPrompt,
  expandDraft,
  mockParseDraft,
  type AiDraft,
  type DraftContext,
  type DraftSuggestion,
} from '@couju/core'
import { AppError } from '../util'

/**
 * AI 组局：自然语言 → 结构化草稿。
 * 只生成草稿；不会创建活动、不会邀请任何人。用户在表单里确认后才会真正创建。
 */
export interface DraftProvider {
  readonly name: 'mock' | 'deepseek'
  parse(text: string, ctx: DraftContext): Promise<AiDraft>
}

export class MockDraftProvider implements DraftProvider {
  readonly name = 'mock' as const
  async parse(text: string, ctx: DraftContext) {
    return mockParseDraft(text, ctx)
  }
}

/**
 * DeepSeek 适配器（OpenAI 兼容 Chat Completions + JSON 输出）。
 * ⚠️ 已按官方接口格式实现，但尚未用真实 API Key 联调验证。
 */
export class DeepSeekDraftProvider implements DraftProvider {
  readonly name = 'deepseek' as const
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = 'https://api.deepseek.com',
    private readonly model = 'deepseek-chat',
    private readonly timeoutMs = 15_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async parse(text: string, ctx: DraftContext): Promise<AiDraft> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.2,
          max_tokens: 800,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: buildDraftSystemPrompt(ctx) },
            { role: 'user', content: text },
          ],
        }),
      })
      if (!res.ok) throw new AppError(502, 'ai_unavailable', `AI 服务暂不可用（${res.status}）`)
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
      const content = body.choices?.[0]?.message?.content
      if (!content) throw new AppError(502, 'ai_bad_output', 'AI 没有返回内容')
      let json: unknown
      try {
        json = JSON.parse(content)
      } catch {
        throw new AppError(502, 'ai_bad_output', 'AI 返回的不是合法 JSON')
      }
      const parsed = aiDraftSchema.safeParse(json)
      if (!parsed.success) throw new AppError(502, 'ai_bad_output', 'AI 返回的结构不符合要求')
      return parsed.data
    } catch (e) {
      if (e instanceof AppError) throw e
      throw new AppError(502, 'ai_unavailable', 'AI 服务连接失败')
    } finally {
      clearTimeout(timer)
    }
  }
}

export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): DraftProvider {
  const key = env.DEEPSEEK_API_KEY?.trim()
  if (key && env.AI_PROVIDER !== 'mock') {
    return new DeepSeekDraftProvider(key, env.DEEPSEEK_BASE_URL || undefined, env.DEEPSEEK_MODEL || undefined)
  }
  return new MockDraftProvider()
}

export async function draftFromText(
  provider: DraftProvider,
  text: string,
  ctx: DraftContext,
): Promise<{ provider: DraftProvider['name']; draft: AiDraft; suggestion: DraftSuggestion }> {
  const draft = await provider.parse(text, ctx)
  return { provider: provider.name, draft, suggestion: expandDraft(draft, ctx) }
}
