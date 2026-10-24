import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { Store } from '../src/store'
import { ConsoleTransport, Mailer } from '../src/services/mailer'
import { notify, listNotifications } from '../src/services/notify'
import * as core from '@couju/core'

let store: Store
let app: ReturnType<typeof createApp>['app']
let mailer: Mailer
let transport: ConsoleTransport
const now = () => new Date('2026-10-23T15:00:00Z')
beforeEach(() => {
  store = new Store(':memory:')
  transport = new ConsoleTransport(false)
  mailer = new Mailer(store, transport, now, 'https://onemore.test', false)
  app = createApp({ store, now, mailer }).app
})
afterEach(() => store.close())
async function call(path: string, locale = 'zh-CN', token?: string, data?: unknown, space?: string, method?: string) {
  const res = await app.request(path, {
    method: method ?? (data === undefined ? 'GET' : 'POST'),
    headers: {
      'Accept-Language': locale,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(space ? { 'X-Space-Id': space } : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  return { status: res.status, body: (await res.json()) as any }
}
async function setup(locale = 'en') {
  const { body: auth } = await call('/api/auth/guest', locale, undefined, { nickname: '日麻', timezone: 'America/Chicago', locale })
  const { body: group } = await call('/api/spaces', locale, auth.token, { name: '中文空间' })
  return { ...auth, space: group.space.id }
}
describe('request and recipient locales', () => {
  it('localizes simultaneous errors and validation without shared request state', async () => {
    const [en, zh] = await Promise.all([call('/api/events', 'en'), call('/api/events', 'zh-CN')])
    expect(en.body.message).toBe('Please sign in and join a space')
    expect(zh.body.message).toBe('请先登录并加入空间')
    expect((await call('/api/auth/guest', 'en', undefined, { nickname: '', timezone: 'Asia/Shanghai' })).body.message).toBe(
      'Please enter a nickname',
    )
  })
  it('persists explicit account locale independently from request locale, space and timezone', async () => {
    const a = await setup()
    expect(a.user.locale).toBe('en')
    const changed = await call('/api/me', 'en', a.token, { locale: 'zh-CN' }, undefined, 'PATCH')
    expect(changed.body.user.locale).toBe('zh-CN')
    expect(changed.body.user.timezone).toBe('America/Chicago')
    expect(changed.body.user.nickname).toBe('日麻')
    expect((await call('/api/games', 'en')).body.games.find((g: any) => g.key === 'riichi').name).toBe('Riichi mahjong')
  })
  it('renders event labels per request while keeping names, notes and instants intact', async () => {
    const a = await setup()
    const created = await call(
      '/api/events',
      'en',
      a.token,
      {
        title: '招人中',
        note: '今天',
        options: [{ gameKey: 'riichi', name: '私人的日麻', minPlayers: 4, maxPlayers: 4 }],
        slots: [{ startUtc: '2026-10-25T01:00:00Z', endUtc: null }],
      },
      a.space,
    )
    const [en, zh] = await Promise.all([
      call(`/api/events/${created.body.code}`, 'en', a.token, undefined, a.space),
      call(`/api/events/${created.body.code}`, 'zh-CN', a.token, undefined, a.space),
    ])
    expect(en.body.event.statusText).toBe('Looking for players')
    expect(zh.body.event.statusText).toBe('招人中')
    expect(en.body.event.title).toBe('招人中')
    expect(en.body.event.note).toBe('今天')
    expect(en.body.event.options[0].name).toBe('私人的日麻')
    expect(en.body.event.slots[0].dateLabel).toBe('10/24 Sat')
    expect(en.body.event.slots[0].startUtc).toBe(zh.body.event.slots[0].startUtc)
  })
  it('rerenders structured notifications for viewers and emails in recipient preference; historical text stays intact', async () => {
    const a = await setup()
    const scoped = store.forSpace(a.space)
    const ctx = { store: scoped, now, mailer, locale: 'zh-CN' as const }
    scoped.saveUserEmail({
      userId: a.user.id,
      email: 'synthetic@example.test',
      enabled: true,
      verifiedAt: now().toISOString(),
      pendingEmail: null,
      codeHash: null,
      codeExpiresAt: null,
      codeAttempts: 0,
      codeSentAt: [],
    })
    notify(ctx, a.user.id, {
      kind: 'friend_request',
      title: core.message('{0} 想加你为好友', '日麻'),
      body: core.message('在“好友”页可以接受'),
      link: '/pages/friends/index',
      dedupeKey: 'new',
    })
    notify(ctx, a.user.id, { kind: 'friend_accepted', title: '旧的中文', body: '历史内容', link: '/pages/friends/index', dedupeKey: 'old' })
    const en = listNotifications({ ...ctx, locale: 'en' }, a.user.id).items
    expect(en.find((n) => n.dedupeKey === 'new')?.title).toBe('日麻 wants to add you as a friend')
    expect(en.find((n) => n.dedupeKey === 'old')?.title).toBe('旧的中文')
    expect(store.listOutbox().find((m) => m.kind === 'friend_request')?.subject).toContain('日麻 wants to add you as a friend')
    expect(store.listOutbox().find((m) => m.kind === 'friend_request')?.text).toContain('Accept on the Friends page')
    expect(listNotifications(ctx, a.user.id).items.find((n) => n.dedupeKey === 'new')?.title).toBe('日麻 想加你为好友')
  })
  it('supports English demo drafts with localized generated titles', async () => {
    const a = await setup()
    const result = await call('/api/ai/draft', 'en', a.token, { text: 'TRPG tomorrow evening with 4 players' }, a.space)
    expect(result.body.suggestion.title).toBe('Tomorrow TRPG')
    expect(result.body.draft.when).toBe('tomorrow')
  })
})

describe('localized system journeys', () => {
  it('returns built-in interest labels in request language and preserves custom names', async () => {
    const a = await setup()
    const standard = await call('/api/interests', 'en', a.token, { gameKey: 'riichi', whenHint: '今天', note: '招人中' }, a.space)
    expect(standard.body.interest.name).toBe('Riichi mahjong')
    expect(standard.body.interest.whenHint).toBe('今天')
    expect(standard.body.interest.note).toBe('招人中')
    const custom = await call('/api/interests', 'en', a.token, { gameKey: 'riichi', name: '我们的日麻' }, a.space)
    expect(custom.body.interest.name).toBe('我们的日麻')
  })
  it('uses account preference for subscription descriptions and preserves notes', async () => {
    const a = await setup()
    const created = await call(
      '/api/events',
      'en',
      a.token,
      {
        title: '成了',
        note: '名单：不要翻译',
        options: [{ gameKey: 'riichi', name: '日麻', minPlayers: 1, maxPlayers: 4 }],
        slots: [{ startUtc: '2026-10-25T01:00:00Z', endUtc: null }],
      },
      a.space,
    )
    const view = await call(`/api/events/${created.body.code}`, 'en', a.token, undefined, a.space)
    await call(
      `/api/events/${created.body.code}/confirm`,
      'en',
      a.token,
      { optionId: view.body.event.options[0].id, slotId: view.body.event.slots[0].id },
      a.space,
    )
    const feed = await call('/api/me/calendar-feed', 'en', a.token, {}, a.space)
    const res = await app.request(feed.body.path, { headers: { 'Accept-Language': 'zh-CN' } })
    const content = await res.text()
    expect(content).toContain('Players: 日麻')
    expect(content).toContain('Riichi mahjong')
    expect(content).toContain('名单：不要翻译')
    expect(content).toContain('DTSTART:20261025T010000Z')
    expect(content).toContain('SUMMARY:🀄 成了')
  })
  it('localizes verification and invite email chrome in the account language', async () => {
    const a = await setup()
    await call('/api/me/email', 'zh-CN', a.token, { email: 'synthetic@example.test' }, a.space)
    const verification = store.listOutbox().find((m) => m.kind === 'verify')!
    expect(verification.subject).toContain('Verification code')
    expect(verification.text).toContain('Valid for 15 minutes')
    expect(verification.html).toContain('lang="en"')
    expect(verification.html).not.toContain('算我一个')
  })
  it('keeps validation and permission errors English even when state is invalid', async () => {
    const a = await setup()
    expect((await call('/api/spaces', 'en', a.token, { name: '' })).body.message).toBe('Please enter a space name')
    const created = await call(
      '/api/events',
      'en',
      a.token,
      {
        options: [{ gameKey: 'riichi', name: '日麻', minPlayers: 1, maxPlayers: 4 }],
        slots: [{ startUtc: '2026-10-25T01:00:00Z', endUtc: null }],
      },
      a.space,
    )
    await call(`/api/events/${created.body.code}/cancel`, 'en', a.token, {}, a.space)
    const invalid = await call(`/api/events/${created.body.code}/confirm`, 'en', a.token, { optionId: 'o1', slotId: 's1' }, a.space)
    expect(invalid.body.message).toBe('This event is Cancelled; this action is unavailable')
  })
})

it('localizes the unsubscribe page in the display language', async () => {
  const a = await setup()
  await call('/api/me/email', 'en', a.token, { email: 'synthetic@example.test' }, a.space)
  const token = store.unsubToken('synthetic@example.test', () => 'synthetic-unsub-token')
  const res = await app.request(`/api/email/unsubscribe/${token}`, { headers: { 'Accept-Language': 'en' } })
  expect(await res.text()).toContain('Unsubscribed')
})

it('rerenders new automatic cancellation reasons while preserving explicit user reasons', async () => {
  const a = await setup()
  const { body: b } = await call('/api/auth/guest', 'en', undefined, { nickname: '明天', timezone: 'Asia/Shanghai', locale: 'en' })
  store.saveMembership({ spaceId: a.space, userId: b.user.id, role: 'member', joinedAt: now().toISOString(), emailEnabled: true })
  const created = await call(
    '/api/events',
    'zh-CN',
    b.token,
    {
      title: '私人活动',
      options: [{ gameKey: 'riichi', name: '日麻', minPlayers: 1, maxPlayers: 4 }],
      slots: [{ startUtc: '2026-10-25T01:00:00Z', endUtc: null }],
    },
    a.space,
  )
  await call(`/api/spaces/${a.space}/leave`, 'en', b.token, {})
  const view = await call(`/api/events/${created.body.code}`, 'en', a.token, undefined, a.space)
  expect(view.body.event.cancelReason).toBe('The host left the space')
  const own = await call(
    '/api/events',
    'en',
    a.token,
    {
      title: '不翻译',
      options: [{ gameKey: 'riichi', name: '日麻', minPlayers: 1, maxPlayers: 4 }],
      slots: [{ startUtc: '2026-10-25T01:00:00Z', endUtc: null }],
    },
    a.space,
  )
  await call(`/api/events/${own.body.code}/cancel`, 'en', a.token, { reason: '组局人已退出空间' }, a.space)
  const ownView = await call(`/api/events/${own.body.code}`, 'en', a.token, undefined, a.space)
  expect(ownView.body.event.cancelReason).toBe('组局人已退出空间')
})

it('renders invitation time fragments per viewer and retains queued permission rechecks', async () => {
  const a = await setup('zh-CN')
  const { body: b } = await call('/api/auth/guest', 'en', undefined, { nickname: '明天', timezone: 'Asia/Shanghai', locale: 'en' })
  store.saveMembership({ spaceId: a.space, userId: b.user.id, role: 'member', joinedAt: now().toISOString(), emailEnabled: true })
  const scoped = store.forSpace(a.space)
  scoped.saveUserEmail({
    userId: b.user.id,
    email: 'synthetic@example.test',
    enabled: true,
    verifiedAt: now().toISOString(),
    pendingEmail: null,
    codeHash: null,
    codeExpiresAt: null,
    codeAttempts: 0,
    codeSentAt: [],
  })
  await call('/api/friends', 'zh-CN', a.token, { handle: b.user.handle }, a.space)
  await call(`/api/friends/${a.user.id}/accept`, 'en', b.token, {}, a.space)
  await call(
    '/api/events',
    'zh-CN',
    a.token,
    {
      title: '招人中',
      options: [{ gameKey: 'riichi', name: '日麻', minPlayers: 1, maxPlayers: 4 }],
      slots: [{ startUtc: '2026-10-25T01:00:00Z', endUtc: null }],
      invite: { userIds: [b.user.id], circleIds: [] },
    },
    a.space,
  )
  const en = (await call('/api/notifications', 'en', b.token, undefined, a.space)).body.items.find((n: any) => n.kind === 'event_invite')
  const zh = (await call('/api/notifications', 'zh-CN', b.token, undefined, a.space)).body.items.find((n: any) => n.kind === 'event_invite')
  expect(en.title).toBe('日麻 invited you: 招人中')
  expect(en.body).toContain('Sun 09:00')
  expect(en.body).not.toContain('周日')
  expect(zh.body).toContain('周日 09:00')
  expect(store.listOutbox().find((m) => m.kind === 'event_invite')?.subject).toContain('invited you')
  await call(`/api/spaces/${a.space}/leave`, 'en', b.token, {})
  await mailer.flush()
  expect(transport.sent.find((m) => m.subject.includes('invited you'))).toBeUndefined()
})

it('localizes schema-generated validation errors without global Zod locale mutation', async () => {
  const a = await setup()
  const [en, zh] = await Promise.all([
    call('/api/me', 'en', a.token, { locale: 'invalid' }, undefined, 'PATCH'),
    call('/api/me', 'zh-CN', a.token, { locale: 'invalid' }, undefined, 'PATCH'),
  ])
  expect(en.status).toBe(400)
  expect(zh.status).toBe(400)
  expect(en.body.message).toBe('Please choose a valid option')
  expect(zh.body.message).toBe('请选择有效选项')
})

it('passes the requested draft language to the optional AI provider without sending anything externally', async () => {
  const { DeepSeekDraftProvider } = await import('../src/ai/providers')
  let payload: any
  const provider = new DeepSeekDraftProvider('synthetic-test-key', 'https://example.invalid', 'test-model', 500, async (_url, init) => {
    payload = JSON.parse(String(init?.body))
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ options: [{ gameKey: 'trpg', name: 'TRPG' }], when: 'tomorrow' }) } }],
      }),
      { status: 200 },
    )
  })
  const draft = await provider.parse('TRPG tomorrow', { now: now(), timezone: 'America/Chicago', locale: 'en' })
  expect(draft.when).toBe('tomorrow')
  expect(payload.messages[0].content).toContain('Output language: English.')
  expect(payload.messages[0].content).toContain('America/Chicago')
  expect(payload.messages[1].content).toBe('TRPG tomorrow')
})

it('renders new interest presets per viewer in both views and notifications while preserving historical free-form hints', async () => {
  const a = await setup('zh-CN')
  const { body: b } = await call('/api/auth/guest', 'en', undefined, {
    nickname: 'Synthetic friend',
    timezone: 'America/Chicago',
    locale: 'en',
  })
  store.saveMembership({ spaceId: a.space, userId: b.user.id, role: 'member', joinedAt: now().toISOString(), emailEnabled: true })
  await call('/api/friends', 'zh-CN', a.token, { handle: b.user.handle }, a.space)
  await call(`/api/friends/${a.user.id}/accept`, 'en', b.token, {}, a.space)
  const created = await call(
    '/api/interests',
    'zh-CN',
    a.token,
    { gameKey: 'riichi', whenPreset: 'this_weekend', audience: { kind: 'friends' } },
    a.space,
  )
  const [en, zh] = await Promise.all([
    call('/api/interests', 'en', b.token, undefined, a.space),
    call('/api/interests', 'zh-CN', b.token, undefined, a.space),
  ])
  expect(en.body.friends.find((i: any) => i.id === created.body.interest.id).whenHint).toBe('This weekend')
  expect(zh.body.friends.find((i: any) => i.id === created.body.interest.id).whenHint).toBe('这周末')
  const enNotice = (await call('/api/notifications', 'en', b.token, undefined, a.space)).body.items.find(
    (n: any) => n.objectId === created.body.interest.id,
  )
  const zhNotice = (await call('/api/notifications', 'zh-CN', b.token, undefined, a.space)).body.items.find(
    (n: any) => n.objectId === created.body.interest.id,
  )
  expect(enNotice.body).toBe('This weekend, Add +1 if interested; no pressure')
  expect(zhNotice.body).toBe('这周末，想玩就 +1，不想玩当没看见')

  const englishCreated = await call(
    '/api/interests',
    'en',
    a.token,
    { gameKey: 'dota2', whenPreset: 'tonight', audience: { kind: 'friends' } },
    a.space,
  )
  const zhTonight = (await call('/api/notifications', 'zh-CN', b.token, undefined, a.space)).body.items.find(
    (n: any) => n.objectId === englishCreated.body.interest.id,
  )
  expect(zhTonight.body).toBe('今晚，想玩就 +1，不想玩当没看见')

  const custom = await call(
    '/api/interests',
    'zh-CN',
    a.token,
    { gameKey: 'boardgame', whenHint: '这周末', note: '历史自定义内容', audience: { kind: 'friends' } },
    a.space,
  )
  const customView = (await call('/api/interests', 'en', b.token, undefined, a.space)).body.friends.find(
    (i: any) => i.id === custom.body.interest.id,
  )
  const customNotice = (await call('/api/notifications', 'en', b.token, undefined, a.space)).body.items.find(
    (n: any) => n.objectId === custom.body.interest.id,
  )
  expect(customView.whenHint).toBe('这周末')
  expect(customView.note).toBe('历史自定义内容')
  expect(customNotice.body).toBe('这周末, Add +1 if interested; no pressure')
})

it('validates optional interest preset identities instead of accepting arbitrary preset labels', async () => {
  const a = await setup()
  const invalid = await call('/api/interests', 'en', a.token, { gameKey: 'riichi', whenPreset: 'custom value' }, a.space)
  expect(invalid.status).toBe(400)
})
