import type { EventStatus, GameEvent } from './types'

/**
 * 活动状态机。
 *
 *   open ──confirm──▶ confirmed ──(活动结束)──▶ completed
 *    │  ▲                │
 *    │  └────reopen──────┤
 *    ├──cancel──▶ cancelled ◀──cancel──┘
 *    └──(所有时段已过)──▶ expired ──add_slots──▶ open
 */

export type EventAction =
  | 'respond'
  | 'confirm'
  | 'cancel'
  | 'reopen'
  | 'invite'
  | 'add_slots'
  | 'final_confirm'
  | 'withdraw'
  | 'promote'

export type ActorRole = 'host' | 'participant'

const RULES: Record<EventStatus, Partial<Record<EventAction, ActorRole[]>>> = {
  open: {
    respond: ['host', 'participant'],
    confirm: ['host'],
    cancel: ['host'],
    invite: ['host'],
    add_slots: ['host'],
    withdraw: ['participant'],
  },
  confirmed: {
    respond: ['participant'],
    final_confirm: ['host', 'participant'],
    withdraw: ['participant'],
    promote: ['host'],
    cancel: ['host'],
    reopen: ['host'],
    invite: ['host'],
  },
  expired: {
    add_slots: ['host'],
    cancel: ['host'],
  },
  cancelled: {},
  completed: {},
}

const STATUS_TEXT: Record<EventStatus, string> = {
  open: '招人中',
  confirmed: '成了',
  cancelled: '取消了',
  expired: '没凑成',
  completed: '玩完了',
}

export function statusText(status: EventStatus): string {
  return STATUS_TEXT[status]
}

export function canPerform(
  status: EventStatus,
  action: EventAction,
  actor: ActorRole,
): { ok: true } | { ok: false; reason: string } {
  const allowed = RULES[status][action]
  if (!allowed) return { ok: false, reason: `这局${STATUS_TEXT[status]}，现在不能这么做` }
  if (!allowed.includes(actor)) return { ok: false, reason: actor === 'host' ? '组局的人不能这么做' : '只有组局的人能这么做' }
  return { ok: true }
}

/** 活动结束时间：最终时段的结束时间；没有结束时间时按开始后 4 小时算。 */
function finalEndMs(event: GameEvent): number | null {
  if (!event.final) return null
  const slot = event.slots.find((s) => s.id === event.final!.slotId)
  if (!slot) return null
  return slot.endUtc ? new Date(slot.endUtc).getTime() : new Date(slot.startUtc).getTime() + 4 * 3600_000
}

/** 根据时间推导出的状态（读取时调用，必要时写回）。 */
export function deriveStatus(event: GameEvent, now: Date = new Date()): EventStatus {
  const t = now.getTime()
  if (event.status === 'open') {
    const anyFuture = event.slots.some((s) => new Date(s.startUtc).getTime() > t)
    return anyFuture ? 'open' : 'expired'
  }
  if (event.status === 'confirmed') {
    const end = finalEndMs(event)
    return end !== null && end < t ? 'completed' : 'confirmed'
  }
  return event.status
}
