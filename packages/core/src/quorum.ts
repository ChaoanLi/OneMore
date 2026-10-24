import { translate, type Locale } from './i18n'
import type { EventOption, EventResponse, GameEvent, RoleRequirement, TimeSlot, UserId } from './types'
import { compareUtc } from './time'

/**
 * 成团规则引擎（纯函数，前后端共用；以后端结果为准）。
 *
 * 规则：
 * 1. 只统计 intent = joined 且该时段可用性为 yes、并接受该玩法的人（“实际报名”），
 *    想玩/待定/也许 不计入成团人数。
 * 2. 同一组（玩法 × 时段）内：人数 ≥ 最低人数，且每个特殊角色都有不同的人承担。
 * 3. 名单：先放角色承担者，再按“发起人优先、其余先报先得”填满上限，其余进候补。
 */

export interface MissingRole {
  key: string
  label: string
  need: number
}

export interface ComboEvaluation {
  optionId: string
  slotId: string
  /** 计入成团的报名者，按优先级排序 */
  eligibleIds: UserId[]
  /** 待定 / 该时段“也许”的人，仅供参考 */
  maybeIds: UserId[]
  feasible: boolean
  /** 还差几人（已把缺少的角色算进去） */
  stillNeed: number
  missingRoles: MissingRole[]
  roster: UserId[]
  waitlist: UserId[]
  roleAssignments: Record<string, UserId[]>
  /** 已到人数上限 */
  full: boolean
}

export interface EventEvaluation {
  combos: ComboEvaluation[]
  /** 最佳组合：可成团优先，其次人数多，其次时间早 */
  best: ComboEvaluation | null
  anyFeasible: boolean
}

function acceptsOption(r: EventResponse, optionId: string): boolean {
  return r.optionIds.length === 0 || r.optionIds.includes(optionId)
}

function orderIds(responses: EventResponse[], hostId: UserId): UserId[] {
  return [...responses]
    .sort((a, b) => {
      if (a.userId === hostId) return -1
      if (b.userId === hostId) return 1
      return a.seq - b.seq
    })
    .map((r) => r.userId)
}

/**
 * 角色分配：把每个角色展开成 min 个“座位”，用二分图匹配给每个座位分配不同的人。
 * 候选人按优先级排序，匹配时优先使用排序靠前的人。
 */
export function assignRoles(
  roles: RoleRequirement[],
  orderedIds: UserId[],
  rolesByUser: Map<UserId, string[]>,
): { assignments: Record<string, UserId[]>; missing: MissingRole[] } {
  const seats: RoleRequirement[] = []
  for (const role of roles) for (let i = 0; i < role.min; i++) seats.push(role)
  const seatOwner: (UserId | null)[] = seats.map(() => null)

  const tryAssign = (userId: UserId, visited: Set<number>): boolean => {
    const userRoles = rolesByUser.get(userId) ?? []
    for (let s = 0; s < seats.length; s++) {
      if (visited.has(s) || !userRoles.includes(seats[s]!.key)) continue
      visited.add(s)
      const owner = seatOwner[s]
      if (owner === null || owner === undefined || tryAssign(owner, visited)) {
        seatOwner[s] = userId
        return true
      }
    }
    return false
  }

  for (const id of orderedIds) {
    if (seatOwner.every((o) => o !== null)) break
    tryAssign(id, new Set())
  }

  const assignments: Record<string, UserId[]> = {}
  const missingMap = new Map<string, MissingRole>()
  seats.forEach((seat, i) => {
    const owner = seatOwner[i]
    if (owner) {
      ;(assignments[seat.key] ??= []).push(owner)
    } else {
      const m = missingMap.get(seat.key) ?? { key: seat.key, label: seat.label, need: 0 }
      m.need += 1
      missingMap.set(seat.key, m)
    }
  })
  return { assignments, missing: [...missingMap.values()] }
}

export function evaluateCombo(
  event: Pick<GameEvent, 'hostId'>,
  option: EventOption,
  slot: TimeSlot,
  responses: EventResponse[],
): ComboEvaluation {
  const eligible = responses.filter(
    (r) => r.intent === 'joined' && r.availability[slot.id] === 'yes' && acceptsOption(r, option.id),
  )
  const maybe = responses.filter(
    (r) =>
      !eligible.includes(r) &&
      (r.intent === 'joined' || r.intent === 'maybe') &&
      (r.availability[slot.id] === 'yes' || r.availability[slot.id] === 'maybe') &&
      acceptsOption(r, option.id),
  )
  const eligibleIds = orderIds(eligible, event.hostId)
  const rolesByUser = new Map(eligible.map((r) => [r.userId, r.roles]))
  const { assignments, missing } = assignRoles(option.roles, eligibleIds, rolesByUser)

  const roleHolders = Object.values(assignments).flat()
  const rest = eligibleIds.filter((id) => !roleHolders.includes(id))
  const ordered = [...roleHolders, ...rest]
  const roster = ordered.slice(0, option.maxPlayers)
  const waitlist = ordered.slice(option.maxPlayers)

  const missingPlayers = Math.max(0, option.minPlayers - eligibleIds.length)
  const missingRoleTotal = missing.reduce((s, m) => s + m.need, 0)
  const feasible = missingPlayers === 0 && missingRoleTotal === 0

  return {
    optionId: option.id,
    slotId: slot.id,
    eligibleIds,
    maybeIds: orderIds(maybe, event.hostId),
    feasible,
    stillNeed: Math.max(missingPlayers, missingRoleTotal),
    missingRoles: missing,
    roster,
    waitlist,
    roleAssignments: assignments,
    full: eligibleIds.length >= option.maxPlayers,
  }
}

export function evaluateEvent(
  event: Pick<GameEvent, 'hostId' | 'options' | 'slots'>,
  responses: EventResponse[],
  now: Date = new Date(),
): EventEvaluation {
  const slotById = new Map(event.slots.map((s) => [s.id, s]))
  const combos: ComboEvaluation[] = []
  for (const option of event.options) {
    for (const slot of event.slots) {
      // 已经开始的时段不再参与成团判断
      if (new Date(slot.startUtc).getTime() <= now.getTime()) continue
      combos.push(evaluateCombo(event, option, slot, responses))
    }
  }
  combos.sort((a, b) => {
    if (a.feasible !== b.feasible) return a.feasible ? -1 : 1
    if (a.stillNeed !== b.stillNeed) return a.stillNeed - b.stillNeed
    if (a.eligibleIds.length !== b.eligibleIds.length) return b.eligibleIds.length - a.eligibleIds.length
    if (a.maybeIds.length !== b.maybeIds.length) return b.maybeIds.length - a.maybeIds.length
    return compareUtc(slotById.get(a.slotId)!.startUtc, slotById.get(b.slotId)!.startUtc)
  })
  return { combos, best: combos[0] ?? null, anyFeasible: combos.some((c) => c.feasible) }
}

/**
 * 成团后检查名单是否仍满足条件（有人退出时）。
 */
export function checkRoster(
  option: EventOption,
  rosterIds: UserId[],
  responses: EventResponse[],
): { ok: boolean; stillNeed: number; missingRoles: MissingRole[]; roleAssignments: Record<string, UserId[]> } {
  const rolesByUser = new Map(responses.map((r) => [r.userId, r.roles]))
  const { assignments, missing } = assignRoles(option.roles, rosterIds, rolesByUser)
  const missingPlayers = Math.max(0, option.minPlayers - rosterIds.length)
  const missingRoleTotal = missing.reduce((s, m) => s + m.need, 0)
  return {
    ok: missingPlayers === 0 && missingRoleTotal === 0,
    stillNeed: Math.max(missingPlayers, missingRoleTotal),
    missingRoles: missing,
    roleAssignments: assignments,
  }
}

/** 给人看的进度描述，例如 “还差 1 人（需要 1 位 KP/GM）” */
export function describeProgress(combo: Pick<ComboEvaluation, 'feasible' | 'stillNeed' | 'missingRoles' | 'full'>, locale: Locale = 'zh-CN'): string {
  if (combo.feasible) return translate(locale, combo.full ? '人齐了，已满员' : '人数够了，可以开局')
  const roles = combo.missingRoles.map((m) => translate(locale, '{0} 位 {1}', m.need, m.label)).join(locale === 'en' ? ', ' : '、')
  return roles ? translate(locale, '还差 {0} 人（需要 {1}）', combo.stillNeed, roles) : translate(locale, '还差 {0} 人', combo.stillNeed)
}
