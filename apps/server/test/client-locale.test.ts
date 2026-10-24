import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { MeResponse, User } from '@couju/core'
const runtime = vi.hoisted(() => ({ storage: new Map<string, unknown>(), device: 'zh-TW', request: vi.fn() }))
vi.mock('@tarojs/taro', () => ({
  useDidShow: vi.fn(),
  useDidHide: vi.fn(),
  default: {
    getStorageSync: (key: string) => runtime.storage.get(key),
    setStorageSync: (key: string, value: unknown) => runtime.storage.set(key, value),
    removeStorageSync: (key: string) => runtime.storage.delete(key),
    getSystemInfoSync: () => ({ language: runtime.device }),
    getCurrentInstance: () => ({ router: { params: {} } }),
    request: runtime.request,
    reLaunch: vi.fn(async () => undefined),
  },
}))
beforeEach(() => {
  vi.resetModules()
  runtime.storage.clear()
  runtime.device = 'zh-TW'
  runtime.request.mockReset()
})
describe('实际语言偏好与会话接线', () => {
  const user: User = {
    id: 'saved-account',
    handle: 'saved_account',
    nickname: 'Saved account',
    avatar: '🎲',
    timezone: 'America/Chicago',
    locale: 'zh-CN',
    games: [],
    roles: [],
    account: { kind: 'guest' },
    createdAt: '2026-10-23T00:00:00.000Z',
  }
  const me: MeResponse = {
    user,
    unread: 0,
    spaces: [{ id: 'friends', name: 'Friends', ownerId: user.id, role: 'owner', createdAt: user.createdAt }],
  }
  it('初次读取账号期间切换语言会重试，并加载账号偏好与空间', async () => {
    runtime.storage.set('couju.token', 'saved-token')
    let finish!: (value: unknown) => void
    runtime.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    runtime.request.mockResolvedValue({ statusCode: 200, data: me })
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    const { requestContext } = await import('../../client/src/lib/requestContext')
    const boot = session.bootSession()
    await i18n.setLocale('en')
    finish({ statusCode: 200, data: me })
    await boot
    expect(session.getSession()).toMatchObject({ ready: true, user, spaces: me.spaces, activeSpace: 'friends' })
    expect(i18n.getLocale()).toBe('zh-CN')
    expect(requestContext.capture()).toMatchObject({ token: 'saved-token', spaceId: 'friends', locale: 'zh-CN' })
    expect(runtime.request.mock.calls[1]![0]).toMatchObject({ url: '/api/me', header: { 'Accept-Language': 'en' } })
    await session.bootSession()
    expect(runtime.request).toHaveBeenCalledTimes(2)
  })
  it('初次读取期间替换身份不会重试或复活旧账号', async () => {
    runtime.storage.set('couju.token', 'saved-token')
    let finish!: (value: unknown) => void
    const replacement: User = { ...user, id: 'new-account', handle: 'new_account', locale: 'en', timezone: 'Europe/London' }
    const replacementMe: MeResponse = { user: replacement, spaces: [], unread: 0 }
    runtime.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    runtime.request.mockImplementation(async (options: any) => ({
      statusCode: 200,
      data: options.url === '/api/auth/guest' ? { token: 'new-token', user: replacement } : replacementMe,
    }))
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    const { requestContext } = await import('../../client/src/lib/requestContext')
    const boot = session.bootSession()
    await session.signupGuest('New account', 'Europe/London')
    finish({ statusCode: 200, data: me })
    await boot
    expect(session.getSession()).toMatchObject({ ready: true, user: replacement, spaces: [], activeSpace: null })
    expect(i18n.getLocale()).toBe('en')
    expect(runtime.storage.get('couju.token')).toBe('new-token')
    expect(requestContext.capture()).toMatchObject({ token: 'new-token', spaceId: null, locale: 'en' })
    expect(runtime.request).toHaveBeenCalledTimes(3)
  })
  it('设备中文默认；显式切换保存到本机并更新 HTTP 上下文，不改空间', async () => {
    const i18n = await import('../../client/src/lib/i18n')
    const { requestContext } = await import('../../client/src/lib/requestContext')
    requestContext.setSpace('friends')
    const persist = vi.fn(async () => undefined)
    i18n.setLocalePersistence(persist)
    expect(i18n.getLocale()).toBe('zh-CN')
    await i18n.setLocale('en')
    expect(runtime.storage.get('onemore.locale')).toBe('en')
    expect(persist).toHaveBeenCalledWith('en')
    expect(requestContext.capture()).toMatchObject({ locale: 'en', spaceId: 'friends' })
    expect(i18n.t('日麻')).not.toMatch(/[\u3400-\u9fff]/)
  })
  it('登录账号的偏好覆盖本机；切换后写入账号，普通刷新不会改回旧偏好', async () => {
    runtime.storage.set('onemore.locale', 'en')
    runtime.storage.set('couju.token', 'test-session')
    let accountLocale = 'zh-CN'
    runtime.request.mockImplementation(async (options: any) => {
      if (options.method === 'PATCH') accountLocale = options.data.locale
      return {
        statusCode: 200,
        data: { user: { id: 'demo', nickname: 'Demo', timezone: 'America/Chicago', locale: accountLocale }, spaces: [] },
      }
    })
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    await session.bootSession()
    expect(i18n.getLocale()).toBe('zh-CN')
    await i18n.setLocale('en')
    expect(session.getSession().user?.locale).toBe('en')
    expect(runtime.request.mock.calls.at(-1)![0]).toMatchObject({
      method: 'PATCH',
      data: { locale: 'en' },
      header: { 'Accept-Language': 'en' },
    })
    expect(session.getSession().user?.timezone).toBe('America/Chicago')
    await session.refreshMe()
    expect(i18n.getLocale()).toBe('en')
  })
})
