import { beforeEach, describe, expect, it } from 'vitest'
import { localToUtc, addMinutes, type AppNotification } from '@couju/core'
import { createApp } from '../src/app'
import { Store } from '../src/store'
import { DeepSeekDraftProvider, MockDraftProvider, type DraftProvider } from '../src/ai/providers'
import { ConsoleTransport, Mailer } from '../src/services/mailer'
import type { EventView } from '../src/services/events'

// 2026-10-23 周五 10:00 美中时间
let now = new Date('2026-10-23T15:00:00Z')
const CHI = 'America/Chicago'
const SH = 'Asia/Shanghai'
const sat = localToUtc('2026-10-24T20:00', CHI)
const sun = localToUtc('2026-10-25T20:00', CHI)
const slot = (start: string) => ({ startUtc: start, endUtc: addMinutes(start, 150) })
const MAHJONG = { gameKey: 'riichi', name: '日麻', minPlayers: 4, maxPlayers: 4 }

let app: ReturnType<typeof createApp>['app']
let mail: ConsoleTransport
let mailer: Mailer
let testSpace: string | undefined
let spaceOwner: string | undefined

function setup(ai: DraftProvider = new MockDraftProvider()) {
  testSpace = undefined
  spaceOwner = undefined
  now = new Date('2026-10-23T15:00:00Z')
  const store = new Store(':memory:')
  mail = new ConsoleTransport(false)
  mailer = new Mailer(store, mail, () => now, 'https://onemore.test', false)
  app = createApp({ store, now: () => now, ai, mailer }).app
}

async function call<T = any>(method: string, path: string, token?: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(testSpace ? { 'X-Space-Id': testSpace } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as T }
}

async function guest(nickname: string, timezone = SH) {
  const { data } = await call<{ token: string; user: { id: string; handle: string } }>('POST', '/api/auth/guest', undefined, { nickname, timezone })
  if(!testSpace) { testSpace=(await call('POST','/api/spaces',data.token,{name:'测试空间'})).data.space.id; spaceOwner=data.token }
  else { const invite=(await call('POST',`/api/spaces/${testSpace}/invite`,spaceOwner)).data.token; const request=(await call('POST',`/api/space-invites/${invite}/requests`,data.token)).data.request; await call('POST',`/api/spaces/${testSpace}/requests/${request.id}/approve`,spaceOwner) }
  return { token: data.token, id: data.user.id, handle: data.user.handle, nickname }
}

type Guest = Awaited<ReturnType<typeof guest>>
async function guests<const N extends readonly string[]>(...names: N): Promise<{ [K in keyof N]: Guest }> {
  const out: Guest[] = []
  for (const n of names) out.push(await guest(n))
  return out as { [K in keyof N]: Guest }
}

async function befriend(a: { token: string }, b: { token: string; handle: string; id: string }, aId: string) {
  await call('POST', '/api/friends', a.token, { handle: b.handle })
  await call('POST', `/api/friends/${aId}/accept`, b.token)
}

const view = async (code: string, token?: string, tz?: string) =>
  (await call<EventView>('GET', `/api/events/${code}${tz ? `?tz=${encodeURIComponent(tz)}` : ''}`, token)).data
const notes = async (token: string) => (await call<{ items: AppNotification[] }>('GET', '/api/notifications', token)).data.items

beforeEach(() => setup())

describe('验收流程：发起 → 分享链接 → 朋友报名 → 系统判断 → 确认开局', () => {
  it('完整走通', async () => {
    const host = await guest('小林', CHI)
    const created = await call<{ code: string }>('POST', '/api/events', host.token, {
      title: '周末日麻',
      options: [MAHJONG],
      slots: [slot(sat), slot(sun)],
    })
    expect(created.status).toBe(200)
    const code = created.data.code

    // 空间成员打开链接：登录后能看到，时间按设备时区（北京）显示，并对照发起人时间
    const previewer = await guest('预览成员', SH)
    const anon = await view(code, previewer.token, SH)
    expect(anon.restricted).toBe(false)
    expect(anon.event.slots[0]).toMatchObject({ dateLabel: '10/25 周日', timeLabel: '09:00–11:30', zoneLabel: '北京时间' })
    expect(anon.event.slots[0]!.hostLine).toBe('美中时间 10/24 周六 20:00 (-1天)')
    expect(anon.event.slots[0]!.localDate).toBe('2026-10-25')
    expect(anon.viewer.role).toBe('participant')

    // 只填昵称就能报名
    const a = await guest('阿杰')
    const b = await guest('老王')
    const c = await guest('Kiki')
    await call('PUT', `/api/events/${code}/response`, a.token, { intent: 'joined', availability: { s1: 'yes' } })
    await call('PUT', `/api/events/${code}/response`, c.token, { intent: 'maybe', availability: { s1: 'yes' } })
    const r = await call<{ view: EventView }>('PUT', `/api/events/${code}/response`, b.token, { intent: 'joined', availability: { s1: 'yes', s2: 'yes' } })
    expect(r.data.view.evaluation!.best).toMatchObject({ slotId: 's1', feasible: false, stillNeed: 1 })

    // 人不够时不能确认
    const early = await call('POST', `/api/events/${code}/confirm`, host.token, { optionId: 'o1', slotId: 's1' })
    expect(early.status).toBe(400)
    expect(early.data.error).toBe('not_feasible')

    // 待定的人被温和提醒“只差 1 人”
    expect((await notes(c.token)).map((n) => n.kind)).toContain('event_short')

    // Kiki 改成报名 → 可以成团，发起人收到提醒
    await call('PUT', `/api/events/${code}/response`, c.token, { intent: 'joined', availability: { s1: 'yes' } })
    const hostView = await view(code, host.token)
    expect(hostView.evaluation!.anyFeasible).toBe(true)
    expect(hostView.evaluation!.best).toMatchObject({ optionId: 'o1', slotId: 's1', feasible: true })
    expect((await notes(host.token)).some((n) => n.kind === 'event_ready')).toBe(true)

    // 非发起人不能确认
    expect((await call('POST', `/api/events/${code}/confirm`, a.token, { optionId: 'o1', slotId: 's1' })).status).toBe(403)

    // 发起人确认开局
    const done = await call<{ view: EventView }>('POST', `/api/events/${code}/confirm`, host.token, { optionId: 'o1', slotId: 's1' })
    expect(done.status).toBe(200)
    expect(done.data.view.event.status).toBe('confirmed')
    expect(done.data.view.event.final!.rosterIds).toEqual([host.id, a.id, b.id, c.id])
    expect(done.data.view.rosterCheck).toMatchObject({ ok: true })

    // 朋友收到成团通知（按各自时区描述时间），并最终确认
    const aNotes = await notes(a.token)
    expect(aNotes[0]).toMatchObject({ kind: 'event_confirmed' })
    expect(aNotes[0]!.body).toContain('10/25 周日 09:00')
    const fc = await call<{ view: EventView }>('POST', `/api/events/${code}/final-confirm`, a.token)
    expect(fc.data.view.viewer.response!.finalConfirmed).toBe(true)

    // 发起人的列表
    const list = await call<{ active: { code: string; statusText: string; progress: string }[] }>('GET', '/api/events', host.token)
    expect(list.data.active[0]).toMatchObject({ code, statusText: '成了', progress: '🀄 日麻 · 4/4 人' })
  })

  it('默认用北京时间：空间成员按北京时间显示，并对照发起人时间', async () => {
    const host = await guest('小林', CHI)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [MAHJONG], slots: [slot(sat)] })
    const previewer = await guest('空间成员')
    const v = await view(data.code, previewer.token)
    expect(v.viewer.timezone).toBe(SH)
    expect(v.event.slots[0]).toMatchObject({ zoneLabel: '北京时间', timeLabel: '09:00–11:30' })
    expect(v.event.slots[0]!.hostLine).toContain('美中时间')
    const bogus = await view(data.code, previewer.token, 'Not/AZone')
    expect(bogus.viewer.timezone).toBe(SH)
  })

  it('提前排几周：最多 24 个候选时间', async () => {
    const host = await guest('小林', SH)
    const days = Array.from({ length: 25 }, (_, i) => slot(new Date(Date.parse(sat) + i * 86400000).toISOString()))
    expect((await call('POST', '/api/events', host.token, { options: [MAHJONG], slots: days.slice(0, 24) })).status).toBe(200)
    const tooMany = await call('POST', '/api/events', host.token, { options: [MAHJONG], slots: days })
    expect(tooMany.status).toBe(400)
    expect(tooMany.data.message).toContain('24')
  })

  it('必须同一时段：两人周六 + 两人周日 不能成团', async () => {
    const host = await guest('小林', CHI)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [MAHJONG], slots: [slot(sat), slot(sun)], hostJoins: false })
    const people = await guests('a', 'b', 'c', 'd')
    for (const [i, p] of people.entries()) {
      await call('PUT', `/api/events/${data.code}/response`, p.token, { intent: 'joined', availability: { [i < 2 ? 's1' : 's2']: 'yes' } })
    }
    const v = await view(data.code, host.token)
    expect(v.evaluation!.anyFeasible).toBe(false)
    expect(v.evaluation!.best!.stillNeed).toBe(2)
  })
})

describe('隐私：不暴露谁拒绝了、谁被邀请、常玩标记', () => {
  it('拒绝者对其他人不可见，发起人只看到匿名人数；邀请名单只给发起人', async () => {
    const host = await guest('小林', CHI)
    const a = await guest('阿杰')
    const b = await guest('老王')
    await befriend(host, a, host.id)
    await befriend(host, b, host.id)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, {
      options: [MAHJONG],
      slots: [slot(sat)],
      invite: { userIds: [a.id, b.id], circleIds: [] },
    })
    await call('PUT', `/api/events/${data.code}/response`, a.token, { intent: 'declined' })
    await call('PUT', `/api/events/${data.code}/response`, b.token, { intent: 'joined' })

    const bView = await view(data.code, b.token)
    expect(bView.participants.map((p) => p.user.nickname)).toEqual(['小林', '老王'])
    expect(bView.hostOnly).toBeNull()
    expect(JSON.stringify(bView)).not.toContain('invitations')

    const hView = await view(data.code, host.token)
    expect(hView.hostOnly!.declinedCount).toBe(1)
    // 拒绝的人和没回应的人看起来一样
    expect(hView.hostOnly!.invitees.find((i) => i.user.id === a.id)!.responded).toBe(false)
    expect(hView.hostOnly!.invitees.find((i) => i.user.id === b.id)!.responded).toBe(true)

    // 被邀请者收到邀请通知，文案无压力
    const n = await notes(a.token)
    expect(n[0]!.kind).toBe('event_invite')
    expect(n[0]!.body).toContain('没空不用回')
  })

  it('常玩标记与圈子只有自己能看到；圈子只能放好友', async () => {
    const me = await guest('小林', CHI)
    const a = await guest('阿杰')
    const stranger = await guest('路人')
    await befriend(me, a, me.id)
    await call('PATCH', `/api/friends/${a.id}`, me.token, { favorite: true })
    const mine = await call<{ friends: { favorite: boolean }[] }>('GET', '/api/friends', me.token)
    expect(mine.data.friends[0]!.favorite).toBe(true)
    const theirs = await call<{ friends: { favorite: boolean }[] }>('GET', '/api/friends', a.token)
    expect(theirs.data.friends[0]!.favorite).toBe(false)

    expect((await call('POST', '/api/circles', me.token, { name: '麻将搭子', memberIds: [a.id, stranger.id] })).status).toBe(400)
    const circle = await call<{ circle: { memberIds: string[] } }>('POST', '/api/circles', me.token, { name: '麻将搭子', memberIds: [a.id] })
    expect(circle.data.circle.memberIds).toEqual([a.id])
    expect((await call<{ circles: unknown[] }>('GET', '/api/circles', a.token)).data.circles).toEqual([])
  })
})

describe('仅邀请可见', () => {
  it('非受邀者只能看到简要信息，不能报名；受邀者可以', async () => {
    const host = await guest('小林', CHI)
    const friend = await guest('阿杰')
    const outsider = await guest('路人')
    await befriend(host, friend, host.id)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, {
      options: [MAHJONG],
      slots: [slot(sat)],
      visibility: 'invited',
      invite: { userIds: [friend.id], circleIds: [] },
    })
    const v = await view(data.code, outsider.token)
    expect(v.restricted).toBe(true)
    expect(v.event.slots).toEqual([])
    expect(v.participants).toEqual([])
    const denied = await call('PUT', `/api/events/${data.code}/response`, outsider.token, { intent: 'joined' })
    expect(denied.status).toBe(403)
    expect((await call('PUT', `/api/events/${data.code}/response`, friend.token, { intent: 'joined' })).status).toBe(200)
  })

  it('扩大邀请：通过圈子追加第二批，只通知新加入的人', async () => {
    const host = await guest('小林', CHI)
    const [a, b, c] = await guests('a', 'b', 'c')
    for (const p of [a, b, c]) await befriend(host, p, host.id)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, {
      options: [MAHJONG],
      slots: [slot(sat)],
      visibility: 'invited',
      invite: { userIds: [a.id], circleIds: [] },
    })
    const circle = await call<{ circle: { id: string } }>('POST', '/api/circles', host.token, { name: '全部', memberIds: [a.id, b.id, c.id] })
    const more = await call<{ added: number; view: EventView }>('POST', `/api/events/${data.code}/invite`, host.token, { circleIds: [circle.data.circle.id] })
    expect(more.data.added).toBe(2)
    expect(more.data.view.hostOnly!.invitees.map((i) => i.wave)).toEqual([1, 2, 2])
    expect((await notes(a.token)).filter((n) => n.kind === 'event_invite')).toHaveLength(1)
  })
})

describe('候补与临时缺人', () => {
  it('满员后报名进候补；有人退出后发起人收到提醒并可补位', async () => {
    const host = await guest('小林', CHI)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [MAHJONG], slots: [slot(sat)] })
    const [a, b, c, d] = await guests('a', 'b', 'c', 'd')
    for (const p of [a, b, c, d]) await call('PUT', `/api/events/${data.code}/response`, p.token, { intent: 'joined' })
    const confirmed = await call<{ view: EventView }>('POST', `/api/events/${data.code}/confirm`, host.token, { optionId: 'o1', slotId: 's1' })
    expect(confirmed.data.view.event.final!.waitlistIds).toEqual([d.id])

    const e = await guest('e')
    const late = await call<{ view: EventView }>('PUT', `/api/events/${data.code}/response`, e.token, { intent: 'joined' })
    expect(late.data.view.viewer.inWaitlist).toBe(true)

    const w = await call<{ view: EventView }>('POST', `/api/events/${data.code}/withdraw`, b.token)
    expect(w.data.view.event.final!.rosterIds).not.toContain(b.id)
    expect(w.data.view.participants.map((p) => p.user.id)).not.toContain(b.id)
    const hostNotes = await notes(host.token)
    expect(hostNotes[0]).toMatchObject({ kind: 'event_short' })
    expect(hostNotes[0]!.body).toContain('候补里有 2 人')

    const hv = await view(data.code, host.token)
    expect(hv.rosterCheck).toMatchObject({ ok: false, stillNeed: 1 })
    const p = await call<{ view: EventView }>('POST', `/api/events/${data.code}/promote`, host.token, { userId: d.id })
    expect(p.data.view.event.final!.rosterIds).toContain(d.id)
    expect(p.data.view.rosterCheck!.ok).toBe(true)
    expect((await notes(d.token))[0]!.kind).toBe('waitlist_promoted')
  })

  it('发起人可以重新开放或取消；取消后通知报名者且不能再报名', async () => {
    const host = await guest('小林', CHI)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [{ ...MAHJONG, minPlayers: 2, maxPlayers: 4 }], slots: [slot(sat)] })
    const a = await guest('a')
    await call('PUT', `/api/events/${data.code}/response`, a.token, { intent: 'joined' })
    await call('POST', `/api/events/${data.code}/confirm`, host.token, { optionId: 'o1', slotId: 's1' })
    const reopened = await call<{ view: EventView }>('POST', `/api/events/${data.code}/reopen`, host.token)
    expect(reopened.data.view.event.status).toBe('open')
    const cancelled = await call<{ view: EventView }>('POST', `/api/events/${data.code}/cancel`, host.token, { reason: '临时有事' })
    expect(cancelled.data.view.event.status).toBe('cancelled')
    expect((await notes(a.token))[0]).toMatchObject({ kind: 'event_cancelled', body: '临时有事' })
    expect((await call('PUT', `/api/events/${data.code}/response`, a.token, { intent: 'joined' })).status).toBe(400)
  })

  it('跑团需要 KP：没有人愿意当 KP 时不能成团', async () => {
    const host = await guest('小林', CHI)
    const trpg = { gameKey: 'trpg', name: '跑团', minPlayers: 3, maxPlayers: 5, roles: [{ key: 'gm', label: 'KP/GM', min: 1 }] }
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [trpg], slots: [slot(sat)] })
    const [a, b] = await guests('a', 'b')
    await call('PUT', `/api/events/${data.code}/response`, a.token, { intent: 'joined' })
    await call('PUT', `/api/events/${data.code}/response`, b.token, { intent: 'joined' })
    let v = await view(data.code, host.token)
    expect(v.evaluation!.best).toMatchObject({ feasible: false, missingRoles: [{ key: 'gm', need: 1 }] })
    await call('PUT', `/api/events/${data.code}/response`, b.token, { intent: 'joined', roles: ['gm'] })
    v = await view(data.code, host.token)
    expect(v.evaluation!.best!.feasible).toBe(true)
  })

  it('时间过去后自动过期，不能再报名；补充新时段后重新开放', async () => {
    const host = await guest('小林', CHI)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [MAHJONG], slots: [slot(sat)] })
    now = new Date('2026-10-26T00:00:00Z')
    expect((await view(data.code, host.token)).event.status).toBe('expired')
    const a = await guest('a')
    expect((await call('PUT', `/api/events/${data.code}/response`, a.token, { intent: 'joined' })).status).toBe(400)
    const next = localToUtc('2026-10-31T20:00', CHI)
    const added = await call<{ view: EventView }>('POST', `/api/events/${data.code}/slots`, host.token, { slots: [slot(next)] })
    expect(added.data.view.event.status).toBe('open')
  })
})

describe('我想玩', () => {
  it('默认只给常玩好友看；人够了通知大家；任何参与者可转为正式活动', async () => {
    const me = await guest('阿杰')
    const [fav1, fav2, other] = await guests('老王', 'Kiki', '小雨')
    for (const p of [fav1, fav2, other]) await befriend(me, p, me.id)
    await call('PATCH', `/api/friends/${fav1.id}`, me.token, { favorite: true })
    await call('PATCH', `/api/friends/${fav2.id}`, me.token, { favorite: true })

    const { data } = await call<{ interest: { id: string; minPlayers: number } }>('POST', '/api/interests', me.token, { gameKey: 'boardgame', whenHint: '这周末' })
    expect(data.interest.minPlayers).toBe(3)
    const id = data.interest.id

    expect((await call<{ friends: unknown[] }>('GET', '/api/interests', other.token)).data.friends).toHaveLength(0)
    const feed = await call<{ friends: { id: string; participants: unknown }[] }>('GET', '/api/interests', fav1.token)
    expect(feed.data.friends[0]!.id).toBe(id)
    expect(feed.data.friends[0]!.participants).toBeNull() // 没 +1 的人看不到名单
    expect((await call('POST', `/api/interests/${id}/join`, other.token)).status).toBe(404)

    await call('POST', `/api/interests/${id}/join`, fav1.token)
    const ready = await call<{ interest: { ready: boolean; headcount: number } }>('POST', `/api/interests/${id}/join`, fav2.token)
    expect(ready.data.interest).toMatchObject({ ready: true, headcount: 3 })
    expect((await notes(fav1.token)).some((n) => n.kind === 'interest_ready')).toBe(true)

    // 老王（不是发起者）来发起正式活动；+1 过的人自动被邀请
    const ev = await call<{ code: string }>('POST', '/api/events', fav1.token, {
      options: [{ gameKey: 'boardgame', name: '桌游', minPlayers: 3, maxPlayers: 6 }],
      slots: [slot(sat)],
      visibility: 'invited',
      invite: { userIds: [], circleIds: [] },
      sourceInterestId: id,
    })
    expect(ev.status).toBe(200)
    const hv = await view(ev.data.code, fav1.token)
    expect(hv.hostOnly!.invitees.map((i) => i.user.id).sort()).toEqual([me.id, fav2.id].sort())
    const mine = await call<{ mine: { status: string; convertedEventCode: string }[] }>('GET', '/api/interests', me.token)
    expect(mine.data.mine[0]).toMatchObject({ status: 'converted', convertedEventCode: ev.data.code })
  })

  it('到期后自动失效', async () => {
    const me = await guest('阿杰')
    const { data } = await call<{ interest: { id: string } }>('POST', '/api/interests', me.token, { gameKey: 'riichi', ttlDays: 1 })
    now = new Date(now.getTime() + 25 * 3600_000)
    const list = await call<{ mine: unknown[] }>('GET', '/api/interests', me.token)
    expect(list.data.mine).toHaveLength(0)
    const friend = await guest('老王')
    expect((await call('POST', `/api/interests/${data.interest.id}/join`, friend.token)).status).toBe(404)
  })
})

describe('身份', () => {
  it('访客 → 生成恢复码 → 在新设备恢复同一个账号', async () => {
    const me = await guest('小林', CHI)
    await call('PATCH', '/api/me', me.token, { handle: 'xiaolin' })
    const bind = await call<{ recoveryCode: string; user: { account: { kind: string } } }>('POST', '/api/me/recovery-code', me.token)
    expect(bind.data.user.account.kind).toBe('bound')
    const bad = await call('POST', '/api/auth/restore', undefined, { handle: 'xiaolin', recoveryCode: 'AAAA-BBBB-CCCC' })
    expect(bad.status).toBe(400)
    const ok = await call<{ token: string; user: { id: string } }>('POST', '/api/auth/restore', undefined, {
      handle: 'xiaolin',
      recoveryCode: bind.data.recoveryCode.toLowerCase(),
    })
    expect(ok.data.user.id).toBe(me.id)
    expect((await call<{ user: { id: string } }>('GET', '/api/me', ok.data.token)).data.user.id).toBe(me.id)
  })

  it('自定义 ID 唯一；内部 ID 不变', async () => {
    const a = await guest('a')
    const b = await guest('b')
    await call('PATCH', '/api/me', a.token, { handle: 'taken_id' })
    expect((await call('PATCH', '/api/me', b.token, { handle: 'taken_id' })).status).toBe(409)
    const renamed = await call<{ user: { id: string; handle: string } }>('PATCH', '/api/me', a.token, { handle: 'new_id' })
    expect(renamed.data.user).toMatchObject({ id: a.id, handle: 'new_id' })
  })

  it('未登录不能报名；微信登录明确返回“未接入”', async () => {
    expect((await call('GET', '/api/events')).status).toBe(401)
    expect((await call('POST', '/api/auth/wechat')).status).toBe(501)
  })
})

describe('AI 草稿', () => {
  it('mock 解析返回可编辑草稿，不会创建活动或邀请任何人', async () => {
    const me = await guest('小林', CHI)
    const r = await call<{ provider: string; suggestion: { options: unknown[]; slots: unknown[]; uncertain: string[] } }>('POST', '/api/ai/draft', me.token, {
      text: '这周末没事，想和几个老朋友玩 Dota、桌游或者日麻',
    })
    expect(r.data.provider).toBe('mock')
    expect(r.data.suggestion.options).toHaveLength(3)
    expect(r.data.suggestion.slots).toHaveLength(4)
    expect((await call<{ active: unknown[] }>('GET', '/api/events', me.token)).data.active).toHaveLength(0)
  })

  it('DeepSeek 返回非法结构 → 502，普通表单创建不受影响', async () => {
    const fakeFetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '{"options":[{"gameKey":"lol","name":"LOL"}]}' } }] }), {
        status: 200,
      })) as unknown as typeof fetch
    setup(new DeepSeekDraftProvider('test-key', 'https://example.invalid', 'deepseek-chat', 1000, fakeFetch))
    const me = await guest('小林', CHI)
    const r = await call('POST', '/api/ai/draft', me.token, { text: '周末打 LOL' })
    expect(r.status).toBe(502)
    expect(r.data.error).toBe('ai_bad_output')
    expect((await call('POST', '/api/events', me.token, { options: [MAHJONG], slots: [slot(sat)] })).status).toBe(200)
  })

  it('DeepSeek 返回合法 JSON → 通过校验并由代码生成时段', async () => {
    let sentBody: any
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ options: [{ gameKey: 'riichi', name: '日麻' }], when: 'tomorrow', timeOfDay: 'evening', uncertain: ['invite'] }) } }] }),
        { status: 200 },
      )
    }) as unknown as typeof fetch
    setup(new DeepSeekDraftProvider('test-key', 'https://example.invalid', 'deepseek-chat', 1000, fakeFetch))
    const me = await guest('小林', CHI)
    const r = await call<{ provider: string; suggestion: { slots: { startUtc: string }[]; uncertain: string[] } }>('POST', '/api/ai/draft', me.token, { text: '明晚打日麻' })
    expect(r.data.provider).toBe('deepseek')
    expect(sentBody.response_format).toEqual({ type: 'json_object' })
    expect(r.data.suggestion.slots[0]!.startUtc).toBe(localToUtc('2026-10-24T20:00', CHI))
    expect(r.data.suggestion.uncertain).toContain('invite')
  })

  it('网络失败 → 502 ai_unavailable', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed')
    }) as unknown as typeof fetch
    setup(new DeepSeekDraftProvider('k', 'https://example.invalid', 'deepseek-chat', 1000, failing))
    const me = await guest('小林', CHI)
    const r = await call('POST', '/api/ai/draft', me.token, { text: '明晚打日麻' })
    expect(r).toMatchObject({ status: 502, data: { error: 'ai_unavailable' } })
  })
})

describe('日历', () => {
  async function confirmedEvent() {
    const host = await guest('小林', CHI)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, {
      title: '周六日麻，逗号, 分号; 测试',
      options: [MAHJONG],
      slots: [slot(sat), slot(sun)],
    })
    const people = await guests('阿杰', '老王', 'Kiki')
    for (const p of people) await call('PUT', `/api/events/${data.code}/response`, p.token, { intent: 'joined', availability: { s1: 'yes' } })
    await call('POST', `/api/events/${data.code}/confirm`, host.token, { optionId: 'o1', slotId: 's1' })
    return { host, people, code: data.code }
  }

  it('月历：成团的局 + 等我回话的候选时间，日期按我的时区', async () => {
    const { people, code } = await confirmedEvent()
    const other = await guest('小雨', SH)
    const host2 = await guest('阿杰2', SH)
    const { data } = await call<{ code: string }>('POST', '/api/events', host2.token, { options: [MAHJONG], slots: [slot(sun)] })
    await call('PUT', `/api/events/${data.code}/response`, other.token, { intent: 'maybe', availability: { s1: 'maybe' } })

    const cal = await call<import('@couju/core').CalendarResponse>('GET', '/api/calendar?month=2026-10', people[0]!.token)
    expect(cal.data).toMatchObject({ month: '2026-10', today: '2026-10-23', timezone: SH })
    // 同组的公开局即使没邀请我、我也没回复，也会作为候选时间出现
    expect(cal.data.items).toEqual([
      expect.objectContaining({ code, kind: 'confirmed', localDate: '2026-10-25', timeLabel: '09:00–11:30' }),
      expect.objectContaining({ code: data.code, kind: 'candidate', myAvailability: null, localDate: '2026-10-26' }),
    ])

    const cal2 = await call<import('@couju/core').CalendarResponse>('GET', '/api/calendar?month=2026-10', other.token)
    expect(cal2.data.items).toEqual([expect.objectContaining({ code: data.code, kind: 'candidate', myAvailability: 'maybe', localDate: '2026-10-26' })])
    expect((await call<import('@couju/core').CalendarResponse>('GET', '/api/calendar?month=2026-11', other.token)).data.items).toEqual([])
  })

  it('订阅：生成链接 → ICS 包含成团的局（UTC 时间、转义、折行）；重新生成后旧链接失效', async () => {
    const { host, people, code } = await confirmedEvent()
    expect((await call<{ enabled: boolean }>('GET', '/api/me/calendar-feed', people[0]!.token)).data.enabled).toBe(false)
    const feed = await call<{ path: string }>('POST', '/api/me/calendar-feed', people[0]!.token)
    expect(feed.data.path).toMatch(/^\/api\/calendar\/feed\/.+\.ics$/)

    const res = await app.request(feed.data.path)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/calendar')
    const raw = await res.text()
    for (const line of raw.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75)
    const ics = raw.replace(/\r\n /g, '') // 还原折行再检查内容
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics).toContain(`DTSTART:20261025T010000Z`)
    expect(ics).toContain('STATUS:CONFIRMED')
    expect(ics).toContain('SUMMARY:🀄 周六日麻，逗号\\, 分号\\; 测试')
    expect(ics).toContain('名单：小林、阿杰、老王、Kiki')
    expect(ics).toContain(`code=${code}`)

    // 取消 → 订阅里标记 CANCELLED（日历应用会划掉）
    await call('POST', `/api/events/${code}/cancel`, host.token, { reason: '' })
    expect(await (await app.request(feed.data.path)).text()).toContain('STATUS:CANCELLED')

    // 重新生成 → 旧链接 404
    const again = await call<{ path: string }>('POST', '/api/me/calendar-feed', people[0]!.token)
    expect((await app.request(feed.data.path)).status).toBe(404)
    expect((await app.request(again.data.path)).status).toBe(200)
    await call('DELETE', '/api/me/calendar-feed', people[0]!.token)
    expect((await app.request(again.data.path)).status).toBe(404)
  })

  it('重新开放的局从订阅中消失；没成团的局不会进订阅', async () => {
    const { host, people, code } = await confirmedEvent()
    const feed = await call<{ path: string }>('POST', '/api/me/calendar-feed', people[1]!.token)
    expect(await (await app.request(feed.data.path)).text()).toContain('BEGIN:VEVENT')
    await call('POST', `/api/events/${code}/reopen`, host.token)
    expect(await (await app.request(feed.data.path)).text()).not.toContain('BEGIN:VEVENT')
  })
})

describe('邮件提醒', () => {
  const settings = (token: string) => call<import('@couju/core').EmailSettingsResponse>('GET', '/api/me/email', token)

  it('留邮箱 → 验证码（演示模式直接返回）→ 验证；错误验证码会被拒绝', async () => {
    const me = await guest('阿杰', CHI)
    const r = await call<import('@couju/core').EmailSettingsResponse>('POST', '/api/me/email', me.token, { email: 'AJie@Example.com' })
    expect(r.data).toMatchObject({ pending: 'ajie@example.com', transport: 'console', email: null })
    expect(r.data.devCode).toMatch(/^\d{6}$/)
    await mailer.flush()
    expect(mail.sent.at(-1)).toMatchObject({ to: 'ajie@example.com', subject: `【算我一个】验证码 ${r.data.devCode}` })

    expect((await call('POST', '/api/me/email/verify', me.token, { code: r.data.devCode === '000000' ? '111111' : '000000' })).status).toBe(400)
    const ok = await call<import('@couju/core').EmailSettingsResponse>('POST', '/api/me/email/verify', me.token, { code: r.data.devCode })
    expect(ok.data).toMatchObject({ email: 'ajie@example.com', enabled: true, pending: null })
    expect((await settings(me.token)).data.email).toBe('ajie@example.com')
  })

  async function verified(name: string, tz: string, address: string) {
    const u = await guest(name, tz)
    const r = await call<{ devCode: string }>('POST', '/api/me/email', u.token, { email: address })
    await call('POST', '/api/me/email/verify', u.token, { code: r.data.devCode })
    await mailer.flush()
    mail.sent.length = 0
    return u
  }

  it('被邀请时同时收到邮件（带活动链接和退订链接）；关闭提醒后不再发', async () => {
    const host = await guest('小林', CHI)
    const friend = await verified('阿杰', CHI, 'ajie@example.com') // 美中 10:00，白天
    await befriend(host, friend, host.id)
    await mailer.flush()
    mail.sent.length = 0
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [MAHJONG], slots: [slot(sat)], invite: { userIds: [friend.id], circleIds: [] } })
    await mailer.flush()
    const m = mail.sent.find((x) => x.subject.includes('约你'))!
    expect(m.to).toBe('ajie@example.com')
    expect(m.text).toContain(`https://onemore.test/#/pages/event/detail?code=${data.code}`)
    expect(m.text).toContain('https://onemore.test/api/email/unsubscribe/')
    expect(m.headers?.['List-Unsubscribe']).toBeTruthy()

    await call('PATCH', '/api/me/email', friend.token, { enabled: false })
    mail.sent.length = 0
    await call('POST', `/api/events/${data.code}/cancel`, host.token, { reason: '' })
    await call('PUT', `/api/events/${data.code}/response`, friend.token, { intent: 'joined' }).catch(() => null)
    await mailer.flush()
    expect(mail.sent).toHaveLength(0)
  })

  it('夜间免打扰：北京 23:00 的提醒顺延到次日 08:30 才发', async () => {
    const host = await guest('小林', CHI)
    const friend = await verified('Kiki', SH, 'kiki@example.com') // now = 北京 23:00
    await befriend(host, friend, host.id)
    await call('POST', '/api/events', host.token, { options: [MAHJONG], slots: [slot(sat)], invite: { userIds: [friend.id], circleIds: [] } })
    await mailer.flush()
    expect(mail.sent.filter((x) => x.to === 'kiki@example.com')).toHaveLength(0)
    now = new Date('2026-10-24T00:31:00Z') // 北京 08:31
    await mailer.flush()
    expect(mail.sent.filter((x) => x.to === 'kiki@example.com').length).toBeGreaterThan(0)
  })

  it('用邮件邀请已验证邮箱的空间成员：去重、仅组局人能发、退订有效', async () => {
    now = new Date('2026-10-23T03:00:00Z') // 北京 11:00
    const host = await guest('小林', CHI)
    const { data } = await call<{ code: string }>('POST', '/api/events', host.token, { options: [MAHJONG], slots: [slot(sat)] })
    await verified('收件人A', SH, 'a@example.com'); await verified('收件人B', SH, 'b@example.com')
    const r = await call<import('@couju/core').EmailInviteResponse>('POST', `/api/events/${data.code}/email-invite`, host.token, {
      emails: ['a@example.com', 'b@example.com', 'a@example.com'],
      message: '缺一个，来吗',
    })
    expect(r.data).toMatchObject({ sent: 2, skipped: [], transport: 'console' })
    await mailer.flush()
    const inv = mail.sent.find((x) => x.to === 'a@example.com' && x.subject.includes('约你'))!
    expect(inv.subject).toBe('[测试空间] 小林 约你：日麻')
    expect(inv.text).toContain('北京时间')
    expect(inv.text).toContain('“缺一个，来吗”')

    const again = await call<import('@couju/core').EmailInviteResponse>('POST', `/api/events/${data.code}/email-invite`, host.token, { emails: ['a@example.com'] })
    expect(again.data.skipped).toEqual([{ email: 'a@example.com', reason: 'duplicate' }])

    const stranger = await guest('路人')
    expect((await call('POST', `/api/events/${data.code}/email-invite`, stranger.token, { emails: ['c@example.com'] })).status).toBe(403)

    const unsub = inv.text.match(/https:\/\/onemore\.test(\/api\/email\/unsubscribe\/\S+)/)![1]!
    const page = await app.request(unsub)
    expect(page.status).toBe(200)
    expect(await page.text()).toContain('已退订')
    now = new Date('2026-10-24T05:00:00Z')
    const after = await call<import('@couju/core').EmailInviteResponse>('POST', `/api/events/${data.code}/email-invite`, host.token, { emails: ['a@example.com'] })
    expect(after.data.skipped).toEqual([{ email: 'a@example.com', reason: 'unsubscribed' }])
    expect((await call('POST', `/api/events/${data.code}/email-invite`, host.token, { emails: ['not-an-email'] })).status).toBe(400)
  })
})

describe('发件队列', () => {
  it('发送失败会退避重试，5 次后标记失败', async () => {
    const store = new Store(':memory:')
    let t = new Date('2026-10-23T03:00:00Z')
    const failing = { kind: 'smtp' as const, send: async () => { throw new Error('SMTP down') } }
    const m = new Mailer(store, failing, () => t, 'https://x.test', false)
    m.enqueue({ to: 'a@example.com', subject: 's', text: 't', html: '<p>t</p>', kind: 'verify' }, { immediate: true })
    for (let i = 1; i <= 5; i++) {
      await m.flush()
      const [item] = store.listOutbox()
      expect(item!.attempts).toBe(i)
      expect(item!.status).toBe(i < 5 ? 'queued' : 'failed')
      t = new Date(t.getTime() + 2 ** (i + 1) * 60_000)
    }
    expect(store.listOutbox()[0]!.lastError).toBe('SMTP down')
  })
})

describe('我的游戏', () => {
  it('保存内置游戏（改人数）+ 自定义游戏；校验人数', async () => {
    const me = await guest('小林', CHI)
    const myGames = [
      { id: 'dota2', gameKey: 'dota2', name: 'Dota 2', emoji: '⚔️', minPlayers: 5, maxPlayers: 10, needsGm: false },
      { id: 'g_ktv', gameKey: null, name: '剧本杀', emoji: '🕵️', minPlayers: 5, maxPlayers: 8, needsGm: true },
    ]
    const r = await call<{ user: { myGames: unknown[]; games: string[] } }>('PATCH', '/api/me', me.token, { myGames })
    expect(r.data.user.myGames).toHaveLength(2)
    expect(r.data.user.games).toEqual(['dota2'])
    const bad = await call('PATCH', '/api/me', me.token, { myGames: [{ ...myGames[0], minPlayers: 6, maxPlayers: 4 }] })
    expect(bad.status).toBe(400)
  })
})
