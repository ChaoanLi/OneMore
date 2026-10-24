import { requestContext } from './requestContext'
import type { DraftSuggestion, InterestView } from '@couju/core'

/**
 * 页面间传递“创建活动”的预填内容（AI 草稿、我想玩转正式活动）。
 * 只在内存中，刷新即失效——草稿本来就需要用户确认后才会提交。
 */
export type CreatePrefill =
  | { source: 'ai'; provider: 'mock' | 'deepseek'; text: string; suggestion: DraftSuggestion }
  | { source: 'interest'; interest: InterestView }

let pending: CreatePrefill | null = null
let context = requestContext.capture()

export function setPrefill(p: CreatePrefill) {
  pending = p
  context = requestContext.capture()
}

export function takePrefill(): CreatePrefill | null {
  const p = requestContext.sameContent(context) ? pending : null
  pending = null
  return p
}
