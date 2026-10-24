import { afterEach, beforeEach, expect, it } from 'vitest'
import { GAME_CATALOG } from '@couju/core'
import { localizeBuiltin } from '../../client/src/lib/localePreference'
import { createApp } from '../src/app'
import { Store } from '../src/store'
let store: Store
let app: ReturnType<typeof createApp>['app']
beforeEach(() => {
  store = new Store(':memory:')
  app = createApp({ store, now: () => new Date('2026-10-23T15:00:00Z') }).app
})
afterEach(() => store.close())
async function call(path: string, method: string, body?: unknown, token?: string, space?: string, locale = 'en') {
  const res = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Accept-Language': locale,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(space ? { 'X-Space-Id': space } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  expect(res.status).toBe(200)
  return res.json() as Promise<any>
}
async function signup() {
  return call('/api/auth/guest', 'POST', { nickname: 'Synthetic', timezone: 'America/Chicago', locale: 'en' })
}
it.each([
  ['riichi', '日麻'],
  ['trpg', 'TRPG 跑团'],
])('client %s catalog creation round-trips through server views and English drafts', async (key, chinese) => {
  const auth = await signup()
  const group = await call('/api/spaces', 'POST', { name: 'Synthetic' }, auth.token)
  const game = localizeBuiltin(GAME_CATALOG.find((g) => g.key === key)!, 'en')
  const created = await call(
    '/api/events',
    'POST',
    {
      title: 'Custom title',
      options: [{ gameKey: key, name: game.name, minPlayers: 4, maxPlayers: 4 }],
      slots: [{ startUtc: '2026-10-25T01:00:00Z', endUtc: null }],
    },
    auth.token,
    group.space.id,
  )
  const view = await call(`/api/events/${created.code}`, 'GET', undefined, auth.token, group.space.id, 'zh-CN')
  expect(view.event.options[0].name).toBe(chinese)
  const draft = await call(
    '/api/ai/draft',
    'POST',
    { text: `${key === 'riichi' ? 'mahjong' : 'TRPG'} tomorrow evening with 4 players` },
    auth.token,
    group.space.id,
  )
  expect(localizeBuiltin(draft.suggestion.options[0], 'zh-CN').name).toBe(chinese)
  expect(localizeBuiltin({ gameKey: key, name: 'Our own game' }, 'zh-CN').name).toBe('Our own game')
})
it.each(['locale', 'profile'])('merges the latest account when the delayed %s body completes last', async (delayedField) => {
  const auth = await signup()
  let controller!: ReadableStreamDefaultController<Uint8Array>
  let entered!: () => void
  const authenticated = new Promise<void>((resolve) => {
    entered = resolve
  })
  const originalGet = store.getSessionUserId.bind(store)
  store.getSessionUserId = (hash) => {
    const id = originalGet(hash)
    entered()
    return id
  }
  const locale = { locale: 'zh-CN' }
  const profile = { timezone: 'Asia/Shanghai', nickname: 'Updated name', roles: ['gm'] }
  const delayed = app.request('/api/me', {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Content-Type': 'application/json',
    },
    body: new ReadableStream<Uint8Array>({
      start(c) {
        controller = c
      },
    }),
    duplex: 'half',
  } as any)
  await authenticated
  store.getSessionUserId = originalGet
  await call('/api/me', 'PATCH', delayedField === 'locale' ? profile : locale, auth.token)
  controller.enqueue(new TextEncoder().encode(JSON.stringify(delayedField === 'locale' ? locale : profile)))
  controller.close()
  expect((await delayed).status).toBe(200)
  const final = await call('/api/me', 'GET', undefined, auth.token)
  expect(final.user).toMatchObject({ ...profile, ...locale })
})
