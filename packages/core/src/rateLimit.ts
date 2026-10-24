import type { AppNotification, NotificationKind } from './types'

/**
 * 通知频率限制：减少打扰，避免“被催”的压力。
 * - 同一 dedupeKey 在 dedupeWindowMs 内只发一次（例如同一活动的“还差 1 人”）。
 * - 每位接收者每类通知每 24 小时有上限。
 */

export interface RateRule {
  dailyMax: number
  dedupeWindowMs: number
}

const HOUR = 3600_000

export const DEFAULT_RULES: Record<NotificationKind, RateRule> = {
  friend_request: { dailyMax: 10, dedupeWindowMs: 72 * HOUR },
  friend_accepted: { dailyMax: 10, dedupeWindowMs: 72 * HOUR },
  event_invite: { dailyMax: 6, dedupeWindowMs: 24 * HOUR },
  event_ready: { dailyMax: 10, dedupeWindowMs: 6 * HOUR },
  event_confirmed: { dailyMax: 20, dedupeWindowMs: 1 * HOUR },
  event_cancelled: { dailyMax: 20, dedupeWindowMs: 1 * HOUR },
  event_updated: { dailyMax: 10, dedupeWindowMs: 1 * HOUR },
  event_short: { dailyMax: 2, dedupeWindowMs: 24 * HOUR },
  waitlist_promoted: { dailyMax: 10, dedupeWindowMs: 1 * HOUR },
  interest_changed: { dailyMax: 10, dedupeWindowMs: 24 * HOUR },
  interest_new: { dailyMax: 3, dedupeWindowMs: 24 * HOUR },
  interest_ready: { dailyMax: 5, dedupeWindowMs: 24 * HOUR },
  join_request: { dailyMax: 5, dedupeWindowMs: 24 * HOUR },
}

export type ThrottleDecision = { send: true } | { send: false; reason: 'duplicate' | 'daily_cap' }

/**
 * @param history 该接收者最近的通知（至少覆盖 24 小时与最长去重窗口）
 */
export function shouldNotify(
  history: Pick<AppNotification, 'kind' | 'dedupeKey' | 'createdAt'>[],
  candidate: { kind: NotificationKind; dedupeKey: string },
  now: Date,
  rules: Record<NotificationKind, RateRule> = DEFAULT_RULES,
): ThrottleDecision {
  const rule = rules[candidate.kind]
  const t = now.getTime()
  const dup = history.some(
    (n) => n.dedupeKey === candidate.dedupeKey && t - Date.parse(n.createdAt) < rule.dedupeWindowMs,
  )
  if (dup) return { send: false, reason: 'duplicate' }
  const todayCount = history.filter((n) => n.kind === candidate.kind && t - Date.parse(n.createdAt) < 24 * HOUR).length
  if (todayCount >= rule.dailyMax) return { send: false, reason: 'daily_cap' }
  return { send: true }
}
