import { describe, expect, it } from 'vitest'
import { canPerform, deriveStatus } from '../src/eventState'
import { shouldNotify } from '../src/rateLimit'
import { interestReady, interestStillNeed, interestVisibleTo, isInterestExpired } from '../src/interest'
import { createEventSchema, respondSchema, updateMeSchema } from '../src/schemas'
import type { GameEvent } from '../src/types'

const NOW = new Date('2026-10-23T15:00:00Z')

function ev(partial: Partial<GameEvent>): GameEvent {
  return {
    id: 'e1',
    code: 'abc',
    hostId: 'host',
    title: 't',
    note: '',
    mode: 'online',
    location: '',
    hostTimezone: 'America/Chicago',
    options: [],
    slots: [{ id: 's1', startUtc: '2026-10-25T01:00:00.000Z', endUtc: '2026-10-25T03:00:00.000Z' }],
    visibility: 'link',
    invitations: [],
    allowWaitlist: true,
    status: 'open',
    final: null,
    cancelReason: '',
    sourceInterestId: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...partial,
  }
}

describe('活动状态机', () => {
  it('只有发起人能确认成团', () => {
    expect(canPerform('open', 'confirm', 'host').ok).toBe(true)
    expect(canPerform('open', 'confirm', 'participant').ok).toBe(false)
  })
  it('已取消的活动不能再报名', () => {
    const r = canPerform('cancelled', 'respond', 'participant')
    expect(r.ok).toBe(false)
  })
  it('成团后可以最终确认、退出、补候补、重新开放', () => {
    expect(canPerform('confirmed', 'final_confirm', 'participant').ok).toBe(true)
    expect(canPerform('confirmed', 'withdraw', 'participant').ok).toBe(true)
    expect(canPerform('confirmed', 'promote', 'host').ok).toBe(true)
    expect(canPerform('confirmed', 'reopen', 'host').ok).toBe(true)
    expect(canPerform('confirmed', 'confirm', 'host').ok).toBe(false)
  })
  it('所有时段都过去 → expired；成团且已结束 → completed', () => {
    expect(deriveStatus(ev({}), NOW)).toBe('open')
    expect(deriveStatus(ev({}), new Date('2026-10-26T00:00:00Z'))).toBe('expired')
    const confirmed = ev({
      status: 'confirmed',
      final: { optionId: 'o', slotId: 's1', rosterIds: [], waitlistIds: [], roleAssignments: {}, confirmedAt: NOW.toISOString() },
    })
    expect(deriveStatus(confirmed, new Date('2026-10-25T02:00:00Z'))).toBe('confirmed')
    expect(deriveStatus(confirmed, new Date('2026-10-25T04:00:00Z'))).toBe('completed')
    expect(deriveStatus(ev({ status: 'cancelled' }), NOW)).toBe('cancelled')
  })
})

describe('通知频率限制', () => {
  const at = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
  it('同一事件 24 小时内的“还差人”只提醒一次', () => {
    const history = [{ kind: 'event_short' as const, dedupeKey: 'short:e1', createdAt: at(3) }]
    expect(shouldNotify(history, { kind: 'event_short', dedupeKey: 'short:e1' }, NOW)).toEqual({ send: false, reason: 'duplicate' })
    expect(shouldNotify(history, { kind: 'event_short', dedupeKey: 'short:e2' }, NOW).send).toBe(true)
  })
  it('“想玩”通知每天最多 3 条', () => {
    const history = [1, 2, 3].map((i) => ({ kind: 'interest_new' as const, dedupeKey: `i${i}`, createdAt: at(i) }))
    expect(shouldNotify(history, { kind: 'interest_new', dedupeKey: 'i9' }, NOW)).toEqual({ send: false, reason: 'daily_cap' })
    const old = history.map((h) => ({ ...h, createdAt: at(30) }))
    expect(shouldNotify(old, { kind: 'interest_new', dedupeKey: 'i9' }, NOW).send).toBe(true)
  })
})

describe('我想玩', () => {
  const base = {
    ownerId: 'me',
    joiners: [{ userId: 'a', at: NOW.toISOString() }],
    minPlayers: 4,
    status: 'active' as const,
    expiresAt: '2026-10-26T15:00:00.000Z',
    audience: { kind: 'favorites' as const },
  }
  it('人数进度', () => {
    expect(interestReady(base)).toBe(false)
    expect(interestStillNeed(base)).toBe(2)
    expect(interestReady({ ...base, joiners: [...base.joiners, { userId: 'b', at: '' }, { userId: 'c', at: '' }] })).toBe(true)
  })
  it('过期', () => {
    expect(isInterestExpired(base, NOW)).toBe(false)
    expect(isInterestExpired(base, new Date('2026-10-27T00:00:00Z'))).toBe(true)
  })
  it('可见范围：常玩好友 / 全部好友 / 圈子；非好友永远看不到', () => {
    const ctx = { ownerFriendIds: new Set(['a', 'b']), ownerFavoriteIds: new Set(['a']), circleMemberIds: new Set(['b']) }
    expect(interestVisibleTo(base, 'a', ctx)).toBe(true)
    expect(interestVisibleTo(base, 'b', ctx)).toBe(false)
    expect(interestVisibleTo({ ...base, audience: { kind: 'friends' } }, 'b', ctx)).toBe(true)
    expect(interestVisibleTo({ ...base, audience: { kind: 'circles', circleIds: ['c1'] } }, 'b', ctx)).toBe(true)
    expect(interestVisibleTo({ ...base, audience: { kind: 'friends' } }, 'stranger', ctx)).toBe(false)
  })
})

describe('输入校验', () => {
  const option = { gameKey: 'riichi', name: '日麻', minPlayers: 4, maxPlayers: 4 }
  const slot = { startUtc: '2026-10-25T01:00:00.000Z', endUtc: '2026-10-25T03:00:00.000Z' }
  it('合法的活动', () => {
    const r = createEventSchema.safeParse({ options: [option], slots: [slot] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.visibility).toBe('link')
  })
  it('最低人数大于上限、结束早于开始、仅邀请却没选人 → 拒绝', () => {
    expect(createEventSchema.safeParse({ options: [{ ...option, minPlayers: 5 }], slots: [slot] }).success).toBe(false)
    expect(createEventSchema.safeParse({ options: [option], slots: [{ ...slot, endUtc: '2026-10-24T00:00:00.000Z' }] }).success).toBe(false)
    expect(createEventSchema.safeParse({ options: [option], slots: [slot], visibility: 'invited' }).success).toBe(false)
  })
  it('自定义 ID 规则与时区校验', () => {
    expect(updateMeSchema.safeParse({ handle: 'Lao_Wang' }).success).toBe(true)
    expect(updateMeSchema.safeParse({ handle: 'a' }).success).toBe(false)
    expect(updateMeSchema.safeParse({ timezone: 'Beijing' }).success).toBe(false)
  })
  it('报名输入', () => {
    expect(respondSchema.safeParse({ intent: 'joined', availability: { s1: 'yes' } }).success).toBe(true)
    expect(respondSchema.safeParse({ intent: 'sure', availability: {} }).success).toBe(false)
  })
})
