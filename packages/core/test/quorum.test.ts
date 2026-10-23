import { describe, expect, it } from 'vitest'
import { assignRoles, checkRoster, describeProgress, evaluateCombo, evaluateEvent } from '../src/quorum'
import type { EventOption, EventResponse, TimeSlot } from '../src/types'

const NOW = new Date('2026-10-23T15:00:00Z')
const S1: TimeSlot = { id: 's1', startUtc: '2026-10-25T01:00:00.000Z', endUtc: null }
const S2: TimeSlot = { id: 's2', startUtc: '2026-10-26T01:00:00.000Z', endUtc: null }
const MAHJONG: EventOption = { id: 'mj', gameKey: 'riichi', name: '日麻', emoji: '🀄', minPlayers: 4, maxPlayers: 4, roles: [] }
const DOTA: EventOption = { id: 'dota', gameKey: 'dota2', name: 'Dota 2', emoji: '⚔️', minPlayers: 5, maxPlayers: 5, roles: [] }
const TRPG: EventOption = {
  id: 'trpg',
  gameKey: 'trpg',
  name: '跑团',
  emoji: '🐙',
  minPlayers: 3,
  maxPlayers: 5,
  roles: [{ key: 'gm', label: 'KP/GM', min: 1 }],
}

let seq = 0
function resp(userId: string, avail: Record<string, 'yes' | 'maybe' | 'no'>, extra: Partial<EventResponse> = {}): EventResponse {
  seq += 1
  return {
    eventId: 'e1',
    userId,
    intent: 'joined',
    availability: avail,
    optionIds: [],
    roles: [],
    finalConfirmed: false,
    comment: '',
    seq,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...extra,
  }
}

const event = (options: EventOption[], slots: TimeSlot[] = [S1, S2]) => ({ hostId: 'host', options, slots })

describe('成团判断', () => {
  it('四人日麻：3 人报名 + 1 人待定 → 还差 1 人；第 4 人报名 → 可成团', () => {
    const rs = [resp('host', { s1: 'yes' }), resp('a', { s1: 'yes' }), resp('b', { s1: 'yes' }), resp('c', { s1: 'yes' }, { intent: 'maybe' })]
    let c = evaluateCombo(event([MAHJONG]), MAHJONG, S1, rs)
    expect(c.feasible).toBe(false)
    expect(c.stillNeed).toBe(1)
    expect(c.maybeIds).toEqual(['c'])
    expect(describeProgress(c)).toBe('还差 1 人')

    rs.push(resp('d', { s1: 'yes' }))
    c = evaluateCombo(event([MAHJONG]), MAHJONG, S1, rs)
    expect(c.feasible).toBe(true)
    expect(c.roster).toEqual(['host', 'a', 'b', 'd'])
    expect(c.full).toBe(true)
  })

  it('“想玩”不计入成团人数', () => {
    const rs = ['host', 'a', 'b'].map((u) => resp(u, { s1: 'yes' }))
    rs.push(resp('x', { s1: 'yes' }, { intent: 'interested' }))
    expect(evaluateCombo(event([MAHJONG]), MAHJONG, S1, rs).feasible).toBe(false)
  })

  it('必须是同一时段：两人周六 + 两人周日 不能凑成四人局', () => {
    const rs = [resp('host', { s1: 'yes' }), resp('a', { s1: 'yes' }), resp('b', { s2: 'yes' }), resp('c', { s2: 'yes' })]
    const ev = evaluateEvent(event([MAHJONG]), rs, NOW)
    expect(ev.anyFeasible).toBe(false)
    expect(ev.best?.stillNeed).toBe(2)
  })

  it('超过上限进候补：先报先得，发起人优先', () => {
    const rs = ['a', 'b', 'c', 'd'].map((u) => resp(u, { s1: 'yes' }))
    rs.push(resp('host', { s1: 'yes' })) // 发起人最后才勾选
    const c = evaluateCombo(event([MAHJONG]), MAHJONG, S1, rs)
    expect(c.roster).toEqual(['host', 'a', 'b', 'c'])
    expect(c.waitlist).toEqual(['d'])
  })

  it('只接受某些玩法的人不计入其他玩法', () => {
    const rs = ['host', 'a', 'b', 'c'].map((u) => resp(u, { s1: 'yes' }))
    rs[3] = { ...rs[3]!, optionIds: ['dota'] }
    expect(evaluateCombo(event([MAHJONG, DOTA]), MAHJONG, S1, rs).feasible).toBe(false)
  })

  it('跑团缺 KP：人数够也不能成团；有人愿意当 KP 后成团，且 KP 占一个座位', () => {
    const rs = ['host', 'a', 'b'].map((u) => resp(u, { s1: 'yes' }))
    let c = evaluateCombo(event([TRPG]), TRPG, S1, rs)
    expect(c.feasible).toBe(false)
    expect(c.missingRoles).toEqual([{ key: 'gm', label: 'KP/GM', need: 1 }])
    expect(describeProgress(c)).toBe('还差 1 人（需要 1 位 KP/GM）')

    rs[1] = { ...rs[1]!, roles: ['gm'] }
    c = evaluateCombo(event([TRPG]), TRPG, S1, rs)
    expect(c.feasible).toBe(true)
    expect(c.roleAssignments).toEqual({ gm: ['a'] })
    expect(c.roster[0]).toBe('a')
  })

  it('满员时 KP 仍然优先进入名单', () => {
    const rs = ['host', 'a', 'b', 'c', 'd'].map((u) => resp(u, { s1: 'yes' }))
    rs.push(resp('kp', { s1: 'yes' }, { roles: ['gm'] }))
    const c = evaluateCombo(event([TRPG]), TRPG, S1, rs)
    expect(c.roster).toContain('kp')
    expect(c.roster).toHaveLength(5)
    expect(c.waitlist).toEqual(['d'])
  })

  it('最佳组合：可成团优先，其次人数多，其次时间早；已开始的时段不参与', () => {
    const rs = ['host', 'a', 'b', 'c'].map((u) => resp(u, { s1: 'yes', s2: 'yes' }))
    const ev = evaluateEvent(event([MAHJONG, DOTA]), rs, NOW)
    expect(ev.best).toMatchObject({ optionId: 'mj', slotId: 's1', feasible: true })
    const later = evaluateEvent(event([MAHJONG]), rs, new Date('2026-10-25T02:00:00Z'))
    expect(later.combos.map((c) => c.slotId)).toEqual(['s2'])
  })
})

describe('角色分配', () => {
  it('用匹配而不是贪心：A 会两种角色、B 只会 gm → A 当 healer，B 当 gm', () => {
    const roles = [
      { key: 'gm', label: 'GM', min: 1 },
      { key: 'healer', label: '奶妈', min: 1 },
    ]
    const r = assignRoles(roles, ['A', 'B'], new Map([['A', ['gm', 'healer']], ['B', ['gm']]]))
    expect(r.missing).toEqual([])
    expect(r.assignments).toEqual({ gm: ['B'], healer: ['A'] })
  })
})

describe('成团后名单检查', () => {
  it('有人退出后人数不足', () => {
    const rs = ['host', 'a', 'b', 'c'].map((u) => resp(u, { s1: 'yes' }))
    expect(checkRoster(MAHJONG, ['host', 'a', 'b', 'c'], rs).ok).toBe(true)
    const after = checkRoster(MAHJONG, ['host', 'a', 'b'], rs)
    expect(after).toMatchObject({ ok: false, stillNeed: 1 })
  })
})
