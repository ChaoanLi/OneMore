import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app'
import { Store } from '../src/store'
import { ConsoleTransport, Mailer } from '../src/services/mailer'

let store: Store
let app: ReturnType<typeof createApp>['app']
const now = () => new Date('2026-10-23T15:00:00Z')
let mail: ConsoleTransport
let mailer: Mailer
async function call(method: string, path: string, token?: string, space?: string, body?: unknown) {
  const r = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(space ? { 'X-Space-Id': space } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return {
    status: r.status,
    data: r.headers.get('content-type')?.includes('application/json') ? ((await r.json()) as any) : await r.text(),
  }
}
async function guest(name: string) {
  return (await call('POST', '/api/auth/guest', undefined, undefined, { nickname: name, timezone: 'Asia/Shanghai' })).data
}
async function space(token: string, name: string) {
  const r = await call('POST', '/api/spaces', token, undefined, { name })
  expect(r.status).toBe(200)
  return r.data.space.id as string
}
async function join(owner: string, member: string, id: string) {
  const invite = await call('POST', `/api/spaces/${id}/invite`, owner)
  expect(invite.status).toBe(200)
  const request = await call('POST', `/api/space-invites/${invite.data.token}/requests`, member)
  expect(request.status).toBe(200)
  const approved = await call('POST', `/api/spaces/${id}/requests/${request.data.request.id}/approve`, owner)
  expect(approved.status).toBe(200)
}
const eventBody = {
  title: '空间内的秘密活动',
  options: [{ gameKey: 'riichi', name: '日麻', minPlayers: 4, maxPlayers: 4 }],
  slots: [{ startUtc: '2026-10-25T15:00:00Z', endUtc: '2026-10-25T18:00:00Z' }],
}
beforeEach(() => {
  store = new Store()
  mail = new ConsoleTransport(false)
  mailer = new Mailer(store, mail, now, 'https://onemore.test', false)
  app = createApp({ store, now, mailer }).app
})
afterEach(() => store.close())

describe('独立空间授权', () => {
  it('成员离开想玩后，剩余参与者收到本空间状态通知', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      A = await space(a.token, 'A'),
      B = await space(a.token, 'B')
    await join(a.token, b.token, A)
    await call('POST', '/api/friends', a.token, A, { handle: b.user.handle })
    await call('POST', `/api/friends/${a.user.id}/accept`, b.token, A)
    const interest = (await call('POST', '/api/interests', a.token, A, { gameKey: 'riichi', audience: { kind: 'friends' } })).data.interest
    await call('POST', `/api/interests/${interest.id}/join`, b.token, A)
    await call('POST', `/api/spaces/${A}/leave`, b.token)
    const notes = (await call('GET', '/api/notifications', a.token, A)).data.items
    expect(notes.some((n: any) => n.kind === 'interest_changed' && n.objectId === interest.id && n.link.includes(`space=${A}`))).toBe(true)
    expect((await call('GET', '/api/notifications', a.token, B)).data.items).toEqual([])
  })
  it('管理员不能通过自己的加入申请被降权，也不能退出自己拥有的空间', async () => {
    const a = await guest('A'),
      A = await space(a.token, 'A')
    const invite = (await call('POST', `/api/spaces/${A}/invite`, a.token)).data.token
    expect((await call('POST', `/api/space-invites/${invite}/requests`, a.token)).data.alreadyMember).toBe(true)
    store.saveJoinRequest({ id: 'owner-request', spaceId: A, userId: a.user.id, status: 'pending', createdAt: now().toISOString() })
    expect((await call('POST', `/api/spaces/${A}/requests/owner-request/approve`, a.token)).status).toBe(200)
    expect(store.getMembership(A, a.user.id)?.role).toBe('owner')
    expect((await call('POST', `/api/spaces/${A}/leave`, a.token)).status).toBe(400)
  })
  it('慢请求在读取正文期间被撤销成员资格后不能写入，即使重新加入也不能恢复旧请求', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      A = await space(a.token, 'A')
    await join(a.token, b.token, A)
    let controller!: ReadableStreamDefaultController<Uint8Array>
    let checked!: () => void
    const authorized = new Promise<void>((resolve) => (checked = resolve))
    const original = store.getMembership.bind(store)
    const spy = vi.spyOn(store, 'getMembership').mockImplementation((space, user) => {
      const m = original(space, user)
      if (space === A && user === b.user.id) checked()
      return m
    })
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    })
    const pending = app.request('/api/events', {
      method: 'POST',
      headers: { Authorization: `Bearer ${b.token}`, 'X-Space-Id': A, 'Content-Type': 'application/json' },
      body,
      duplex: 'half',
    } as any)
    await authorized
    spy.mockRestore()
    await call('DELETE', `/api/spaces/${A}/members/${b.user.id}`, a.token)
    await join(a.token, b.token, A)
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...eventBody, hostJoins: false })))
    controller.close()
    expect((await pending).status).toBe(403)
    expect(store.forSpace(A).listEventsForUser(b.user.id)).toEqual([])
  })
  it('没有空间时不读取全局业务数据，不能伪造成员资格', async () => {
    const a = await guest('A'),
      b = await guest('B')
    const id = await space(a.token, 'A空间')
    expect((await call('GET', '/api/events', a.token)).status).toBe(400)
    expect((await call('GET', '/api/events', b.token, id)).status).toBe(403)
    expect((await call('GET', `/api/spaces/${id}/members`, b.token)).status).toBe(403)
    expect((await call('GET', '/api/me', b.token)).data.spaces).toEqual([])
  })
  it('申请批准后才加入，更换链接和非管理员管理均受限制', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      c = await guest('C')
    const id = await space(a.token, 'A空间')
    const old = (await call('POST', `/api/spaces/${id}/invite`, a.token)).data.token
    const req = await call('POST', `/api/space-invites/${old}/requests`, b.token)
    expect(req.status).toBe(200)
    expect((await call('GET', '/api/events', b.token, id)).status).toBe(403)
    expect((await call('POST', `/api/spaces/${id}/requests/${req.data.request.id}/approve`, b.token)).status).toBe(403)
    await call('POST', `/api/spaces/${id}/invite`, a.token)
    expect((await call('POST', `/api/space-invites/${old}/requests`, c.token)).status).toBe(404)
    expect((await call('POST', `/api/spaces/${id}/requests/${req.data.request.id}/approve`, a.token)).status).toBe(200)
    expect((await call('POST', `/api/spaces/${id}/requests/${req.data.request.id}/approve`, a.token)).status).toBe(200)
    expect((await call('GET', '/api/events', b.token, id)).status).toBe(200)
    expect((await call('POST', `/api/spaces/${id}/leave`, a.token)).status).toBe(400)
  })
  it('共同成员的活动与通知隔离，外空间及匿名链接不泄露任何标题', async () => {
    const a = await guest('A'),
      b = await guest('B')
    const A = await space(a.token, 'A空间'),
      B = await space(a.token, 'B空间')
    await join(a.token, b.token, A)
    const e = await call('POST', '/api/events', a.token, A, eventBody)
    expect(e.status).toBe(200)
    expect((await call('GET', '/api/events', a.token, B)).data.active).toEqual([])
    for (const [t, s] of [
      [a.token, B],
      [undefined, A],
    ] as const) {
      const v = await call('GET', `/api/events/${e.data.code}`, t, s)
      expect(v.status).toBeGreaterThanOrEqual(400)
      expect(JSON.stringify(v.data)).not.toContain(eventBody.title)
    }
    expect((await call('GET', `/api/events/${e.data.code}`, b.token, A)).status).toBe(200)
    expect((await call('POST', `/api/events/${e.data.code}/cancel`, a.token, B)).status).toBe(404)
  })
  it('组里的公开局所有成员都能在列表和月历里看到，包括建局之后才入组的人', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      c = await guest('C')
    const A = await space(a.token, 'A空间')
    await join(a.token, b.token, A)
    expect((await call('POST', '/api/friends', a.token, A, { handle: b.user.handle })).status).toBe(200)
    expect((await call('POST', `/api/friends/${a.user.id}/accept`, b.token, A)).status).toBe(200)
    const open = await call('POST', '/api/events', a.token, A, { ...eventBody, title: '全组可见' })
    const secret = await call('POST', '/api/events', a.token, A, {
      ...eventBody,
      title: '只邀请B',
      visibility: 'invited',
      invite: { userIds: [b.user.id], circleIds: [] },
    })
    expect(open.status).toBe(200)
    expect(secret.status).toBe(200)
    // C 在两个局都建好之后才入组
    await join(a.token, c.token, A)
    const titles = async (token: string) => ((await call('GET', '/api/events', token, A)).data.active as { title: string }[]).map((e) => e.title)
    expect(await titles(c.token)).toEqual(['全组可见'])
    expect((await titles(b.token)).sort()).toEqual(['全组可见', '只邀请B'].sort())
    const cal = JSON.stringify((await call('GET', '/api/calendar?month=2026-10', c.token, A)).data)
    expect(cal).toContain('全组可见')
    expect(cal).not.toContain('只邀请B')
  })
  it('朋友页列出同组里还不是好友的人，一键加好友后从列表移走', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      c = await guest('C'),
      d = await guest('D')
    const A = await space(a.token, 'A空间'),
      B = await space(d.token, 'D空间')
    await join(a.token, b.token, A)
    await join(a.token, c.token, A)
    const mates = async (token: string) =>
      ((await call('GET', '/api/friends', token, A)).data.groupMates as { id: string }[]).map((u) => u.id).sort()
    expect(await mates(a.token)).toEqual([b.user.id, c.user.id].sort())
    // 别的组的人不出现
    expect(await mates(a.token)).not.toContain(d.user.id)
    expect((await call('POST', '/api/friends', a.token, A, { handle: b.user.handle })).status).toBe(200)
    // 发出请求后，A 那边 B 进“等对方点头”；B 那边 A 进“有人想加你”
    expect(await mates(a.token)).toEqual([c.user.id])
    expect(await mates(b.token)).toEqual([c.user.id])
    expect((await call('POST', '/api/friends', b.token, A, { handle: a.user.handle })).data.status).toBe('accepted')
    expect(await mates(b.token)).toEqual([c.user.id])
    expect((await call('GET', '/api/friends', d.token, B)).data.groupMates).toEqual([])
  })
  it('同一对人的好友、圈子、想玩和用户搜索按空间独立', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      c = await guest('C')
    const A = await space(a.token, 'A空间'),
      B = await space(a.token, 'B空间')
    await join(a.token, b.token, A)
    await join(a.token, b.token, B)
    await join(a.token, c.token, A)
    for (const id of [A, B]) {
      expect((await call('POST', '/api/friends', a.token, id, { handle: b.user.handle })).status).toBe(200)
      expect((await call('POST', `/api/friends/${a.user.id}/accept`, b.token, id)).status).toBe(200)
    }
    await call('DELETE', `/api/friends/${b.user.id}`, a.token, A)
    expect((await call('GET', '/api/friends', a.token, B)).data.friends).toHaveLength(1)
    expect((await call('GET', `/api/users/${c.user.handle}`, a.token, B)).status).toBe(404)
    const circle = await call('POST', '/api/circles', a.token, A, { name: '私密圈子', memberIds: [] })
    expect((await call('PUT', `/api/circles/${circle.data.circle.id}`, a.token, B, { name: '篡改', memberIds: [] })).status).toBe(404)
    expect((await call('POST', '/api/circles', a.token, B, { name: '错误成员', memberIds: [c.user.id] })).status).toBe(400)
    expect((await call('POST', '/api/events', a.token, B, { ...eventBody, invite: { userIds: [c.user.id] } })).status).toBe(400)
  })
  it('并发的空间请求不共享当前空间，通知已读及月历不串组', async () => {
    const a = await guest('A'),
      A = await space(a.token, 'A空间'),
      B = await space(a.token, 'B空间')
    const [x, y] = await Promise.all([
      call('POST', '/api/events', a.token, A, { ...eventBody, title: '仅A' }),
      call('POST', '/api/events', a.token, B, { ...eventBody, title: '仅B' }),
    ])
    expect(x.status).toBe(200)
    expect(y.status).toBe(200)
    expect(JSON.stringify((await call('GET', '/api/events', a.token, A)).data)).not.toContain('仅B')
    expect(JSON.stringify((await call('GET', '/api/calendar', a.token, B)).data)).not.toContain('仅A')
    const n = (id: string) => ({
      id,
      userId: a.user.id,
      kind: 'event_invite' as const,
      title: id,
      body: '',
      link: '',
      dedupeKey: id,
      createdAt: now().toISOString(),
      readAt: null,
    })
    store.forSpace(A).saveNotification(n('A'))
    store.forSpace(B).saveNotification(n('B'))
    await call('POST', '/api/notifications/read', a.token, A)
    expect((await call('GET', '/api/notifications', a.token, B)).data.unread).toBe(1)
  })
  it('移除成员使令牌订阅及业务权限失效，重新加入不恢复好友', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      A = await space(a.token, 'A空间'),
      B = await space(a.token, 'B空间')
    await join(a.token, b.token, A)
    await join(a.token, b.token, B)
    for (const id of [A, B]) {
      await call('POST', '/api/friends', a.token, id, { handle: b.user.handle })
      await call('POST', `/api/friends/${a.user.id}/accept`, b.token, id)
    }
    const feed = (await call('POST', '/api/me/calendar-feed', b.token, A)).data.path
    expect((await call('GET', feed)).status).toBe(200)
    expect((await call('DELETE', `/api/spaces/${A}/members/${b.user.id}`, a.token)).status).toBe(200)
    expect((await call('GET', feed)).status).toBe(404)
    expect((await call('GET', '/api/events', b.token, A)).status).toBe(403)
    expect((await call('GET', '/api/friends', b.token, B)).data.friends).toHaveLength(1)
    await join(a.token, b.token, A)
    expect((await call('GET', '/api/friends', b.token, A)).data.friends).toEqual([])
    expect((await call('GET', '/api/me/calendar-feed', b.token, A)).data.enabled).toBe(false)
  })
  it('外空间想玩和圈子不能被加入或用于创建活动', async () => {
    const a = await guest('A'),
      A = await space(a.token, 'A'),
      B = await space(a.token, 'B')
    const interest = (await call('POST', '/api/interests', a.token, A, { gameKey: 'riichi', audience: { kind: 'friends' } })).data.interest
    expect((await call('POST', `/api/interests/${interest.id}/join`, a.token, B)).status).toBe(404)
    expect((await call('POST', '/api/events', a.token, B, { ...eventBody, sourceInterestId: interest.id })).status).toBe(400)
    const circle = (await call('POST', '/api/circles', a.token, A, { name: 'A的圈子', memberIds: [] })).data.circle
    expect(
      (await call('POST', '/api/interests', a.token, B, { gameKey: 'riichi', audience: { kind: 'circles', circleIds: [circle.id] } }))
        .status,
    ).toBe(400)
    expect((await call('POST', '/api/events', a.token, B, { ...eventBody, invite: { circleIds: [circle.id] } })).status).toBe(400)
  })
  it('退出取消自己未结束的活动并撤回他人未来活动参与，只影响本空间', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      A = await space(a.token, 'A'),
      B = await space(a.token, 'B')
    await join(a.token, b.token, A)
    await join(a.token, b.token, B)
    const hosted = (await call('POST', '/api/events', b.token, A, eventBody)).data.code
    const other = (await call('POST', '/api/events', a.token, A, eventBody)).data.code
    await call('PUT', `/api/events/${other}/response`, b.token, A, { intent: 'joined' })
    const untouched = (await call('POST', '/api/events', b.token, B, eventBody)).data.code
    await call('POST', `/api/spaces/${A}/leave`, b.token)
    expect((await call('GET', `/api/events/${hosted}`, a.token, A)).data.event.status).toBe('cancelled')
    expect((await call('GET', `/api/events/${other}`, a.token, A)).data.participants.map((p: any) => p.user.id)).not.toContain(b.user.id)
    expect((await call('GET', `/api/events/${untouched}`, b.token, B)).data.event.status).toBe('open')
    await join(a.token, b.token, A)
    expect((await call('GET', `/api/events/${other}`, b.token, A)).data.viewer.response).toBe(null)
  })
  it('未知邮箱不收到活动详情，空间邮件开关独立，发送前重新检查成员权限', async () => {
    const a = await guest('A'),
      b = await guest('B'),
      A = await space(a.token, 'A'),
      B = await space(a.token, 'B')
    await join(a.token, b.token, A)
    await join(a.token, b.token, B)
    const bind = await call('POST', '/api/me/email', b.token, A, { email: 'b@example.com' })
    await call('POST', '/api/me/email/verify', b.token, A, { code: bind.data.devCode })
    await mailer.flush()
    mail.sent.length = 0
    await call('PATCH', '/api/me/email', b.token, A, { enabled: false })
    expect((await call('GET', '/api/me/email', b.token, A)).data.enabled).toBe(false)
    expect((await call('GET', '/api/me/email', b.token, B)).data.enabled).toBe(true)
    const e = (await call('POST', '/api/events', a.token, A, eventBody)).data.code
    expect((await call('POST', `/api/events/${e}/email-invite`, a.token, A, { emails: ['unknown@example.com'] })).status).toBe(400)
    await call('PATCH', '/api/me/email', b.token, A, { enabled: true })
    mailer.enqueue(
      { to: 'b@example.com', subject: '不能泄露', text: '详情', html: '详情', kind: 'event_invite' },
      { immediate: true, spaceId: A, recipientId: b.user.id, objectCode: e },
    )
    await call('DELETE', `/api/spaces/${A}/members/${b.user.id}`, a.token)
    await join(a.token, b.token, A)
    await mailer.flush()
    expect(mail.sent).toEqual([])
    // Unscoped old event messages must never become sendable on upgrade.
    mailer.enqueue({ to: 'b@example.com', subject: '旧活动', text: '旧详情', html: '旧详情', kind: 'event_invite' }, { immediate: true })
    await mailer.flush()
    expect(mail.sent).toEqual([])
  })
})
