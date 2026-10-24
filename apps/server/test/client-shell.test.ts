// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
const runtime = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  shows: new Set<() => void>(),
  hides: new Set<() => void>(),
  path: '/pages/calendar/index?stamp=internal',
  request: vi.fn(),
  title: vi.fn(),
  clipboard: vi.fn(),
}))
vi.mock('@tarojs/taro', async () => {
  const { useEffect, useRef } = await import('react')
  const lifecycle = (set: Set<() => void>, callback: () => void) => {
    const ref = useRef(callback)
    ref.current = callback
    useEffect(() => {
      const run = () => ref.current()
      set.add(run)
      return () => {
        set.delete(run)
      }
    }, [])
  }
  return {
    useDidShow: (cb: () => void) => lifecycle(runtime.shows, cb),
    useDidHide: (cb: () => void) => lifecycle(runtime.hides, cb),
    useRouter: () => ({ path: runtime.path, params: {} }),
    default: {
      getStorageSync: (key: string) => runtime.storage.get(key),
      setStorageSync: (key: string, value: unknown) => runtime.storage.set(key, value),
      removeStorageSync: (key: string) => runtime.storage.delete(key),
      getSystemInfoSync: () => ({ language: 'en' }),
      getCurrentInstance: () => ({ router: { params: {} } }),
      request: runtime.request,
      setNavigationBarTitle: runtime.title,
      reLaunch: vi.fn(async () => undefined),
      showToast: vi.fn(),
      setClipboardData: runtime.clipboard,
    },
  }
})
// Replace only the platform DOM adapters; all Page/Calendar/Sheet/session logic is real.
vi.mock('@tarojs/components', async () => {
  const { createElement } = await import('react')
  const element =
    (tag: string) =>
    ({ children, ...props }: any) =>
      createElement(
        tag,
        Object.fromEntries(
          Object.entries(props).filter(
            ([key]) => ['className', 'onClick', 'role', 'disabled', 'style', 'src'].includes(key) || key.startsWith('aria-'),
          ),
        ),
        children,
      )
  return {
    View: element('div'),
    Text: element('span'),
    Button: element('button'),
    Image: element('img'),
    Input: element('input'),
    Picker: element('div'),
  }
})
let root: Root | undefined
let container: any
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
const user = {
  id: 'synthetic',
  handle: 'synthetic',
  nickname: 'Synthetic',
  avatar: '🎲',
  timezone: 'America/Chicago',
  locale: 'en',
  games: [],
  roles: [],
  account: { kind: 'guest' },
  createdAt: '2026-10-23T00:00:00Z',
}
const spaces = ['A', 'B'].map((id) => ({ id, name: id, ownerId: user.id, role: 'owner', createdAt: user.createdAt }))
beforeEach(() => {
  vi.resetModules()
  runtime.storage.clear()
  runtime.storage.set('couju.token', 'synthetic-token')
  runtime.path = '/pages/calendar/index?stamp=internal'
  runtime.request.mockReset()
  runtime.title.mockReset()
  runtime.clipboard.mockReset()
  runtime.clipboard.mockResolvedValue(undefined)
  let enabled = false
  runtime.request.mockImplementation(async (o: any) => {
    let data: unknown
    if (o.url === '/api/me') data = { user: o.method === 'PATCH' ? { ...user, ...o.data } : user, spaces, unread: 0 }
    else if (o.url === '/api/me/calendar-feed') {
      if (o.method === 'POST') enabled = true
      data = { enabled, path: o.method === 'POST' ? '/api/calendar/feed/synthetic-secret.ics' : null }
    } else data = { month: '2026-10', today: '2026-10-23', timezone: 'America/Chicago', items: [] }
    return { statusCode: 200, data }
  })
  container = (globalThis as any).document.createElement('div')
  root = createRoot(container)
})
afterEach(() => {
  act(() => root!.unmount())
  root = undefined
})
async function show() {
  await act(async () => {
    runtime.shows.forEach((cb) => cb())
  })
}
async function click(text: string) {
  const node = [...container.querySelectorAll('[role="button"],button,.list-row')].find((el: any) => el.textContent === text) as any
  expect(node, text).toBeDefined()
  await act(async () => node.click())
}
it('keeps a generated feed URL through language refresh and clears it across space/account boundaries', async () => {
  const session = await import('../../client/src/lib/session')
  const i18n = await import('../../client/src/lib/i18n')
  await session.bootSession()
  const path = new URL('../../client/src/pages/calendar/index.tsx', import.meta.url).pathname
  const { default: Calendar } = await import(path)
  await act(async () => root!.render(createElement(Calendar)))
  await show()
  await show() // FeedCard is now mounted, just as returning to a cached calendar page.
  await click('Calendar subscription')
  await click('Generate subscription link')
  expect(container.textContent).toContain('/api/calendar/feed/synthetic-secret.ics')
  await act(async () => {
    await i18n.setLocale('zh-CN')
  })
  expect(container.textContent).toContain('/api/calendar/feed/synthetic-secret.ics')
  await click('复制链接')
  expect(runtime.clipboard).toHaveBeenCalledWith({ data: '/api/calendar/feed/synthetic-secret.ics' })
  expect(runtime.request.mock.calls.filter(([o]) => o.url === '/api/me/calendar-feed' && o.method === 'POST')).toHaveLength(1)
  await act(async () => {
    await session.selectSpace('B')
  })
  expect(container.textContent).not.toContain('synthetic-secret')
  await act(async () => {
    await session.selectSpace('A')
  })
  expect(container.textContent).not.toContain('synthetic-secret')
  await act(async () => {
    session.logout()
  })
  expect(container.textContent).not.toContain('synthetic-secret')
})
it.each([
  ['/pages/me/index?stamp=internal', 'Account', '账号'],
  ['/pages/ai/index?stamp=internal', 'Start with an idea', '随口说一句'],
  ['/pages/event/create?stamp=internal', 'Plan a session', '我来组一局'],
])('sets translated titles for logical route %s', async (path, en, zh) => {
  runtime.path = path!
  const session = await import('../../client/src/lib/session')
  const i18n = await import('../../client/src/lib/i18n')
  await session.bootSession()
  const pageModule = new URL('../../client/src/components/Page.tsx', import.meta.url).pathname
  const { Page } = await import(pageModule)
  await act(async () => root!.render(createElement(Page, { global: true })))
  await show()
  expect(runtime.title).toHaveBeenLastCalledWith({ title: en })
  await act(async () => {
    await i18n.setLocale('zh-CN')
  })
  expect(runtime.title).toHaveBeenLastCalledWith({ title: zh })
})
it('an explicit click on the current language persists a legacy account preference', async () => {
  runtime.request.mockResolvedValue({ statusCode: 200, data: { user: { ...user, locale: undefined }, spaces: [], unread: 0 } })
  const session = await import('../../client/src/lib/session')
  await session.bootSession()
  const pageModule = new URL('../../client/src/components/Page.tsx', import.meta.url).pathname
  const { Page } = await import(pageModule)
  await act(async () => root!.render(createElement(Page, { global: true })))
  runtime.request.mockResolvedValue({ statusCode: 200, data: { user } })
  await click('EN')
  expect(runtime.request.mock.calls.filter(([o]) => o.method === 'PATCH')).toEqual([[expect.objectContaining({ data: { locale: 'en' } })]])
  expect(session.getSession().user?.locale).toBe('en')
})
