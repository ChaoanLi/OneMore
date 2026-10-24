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
  it.each([false, true])('a new bootstrap selection wins an older account read (cached=%s)', async (cached) => {
    runtime.storage.set('couju.token', 'saved-token')
    if (cached) runtime.storage.set('couju.user', JSON.stringify(user))
    let finish!: (value: unknown) => void
    runtime.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    runtime.request.mockImplementation(async (options: any) => ({
      statusCode: 200,
      data: options.method === 'PATCH' ? { user: { ...user, locale: options.data.locale } } : me,
    }))
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    const { requestContext } = await import('../../client/src/lib/requestContext')
    const boot = session.bootSession()
    const selection = i18n.setLocale('en')
    finish({ statusCode: 200, data: me })
    await boot
    await selection
    expect(session.getSession()).toMatchObject({ ready: true, user: { ...user, locale: 'en' }, spaces: me.spaces, activeSpace: 'friends' })
    expect(JSON.parse(runtime.storage.get('couju.user') as string).locale).toBe('en')
    expect(i18n.getLocale()).toBe('en')
    expect(requestContext.capture()).toMatchObject({ token: 'saved-token', spaceId: 'friends', locale: 'en' })
    expect(runtime.request.mock.calls.filter(([o]) => o.method === 'PATCH')).toEqual([
      [
        expect.objectContaining({
          url: '/api/me',
          data: { locale: 'en' },
          header: expect.objectContaining({ Authorization: 'Bearer saved-token' }),
        }),
      ],
    ])
  })
  it('does not persist a pending bootstrap choice onto a replacement identity', async () => {
    runtime.storage.set('couju.token', 'saved-token')
    let finish!: (value: unknown) => void
    runtime.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const replacement = { ...user, id: 'replacement', locale: 'zh-CN' }
    runtime.request.mockImplementation(async (options: any) => ({
      statusCode: 200,
      data: options.url === '/api/auth/guest' ? { token: 'replacement-token', user: replacement } : { user: replacement, spaces: [] },
    }))
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    const boot = session.bootSession()
    const choice = i18n.setLocale('en')
    await session.signupGuest('Replacement')
    finish({ statusCode: 200, data: me })
    await Promise.all([boot, choice])
    expect(session.getSession().user).toEqual(replacement)
    expect(runtime.request.mock.calls.filter(([o]) => o.method === 'PATCH')).toHaveLength(0)
  })
  it.each(['/api/events', '/api/me/recovery-code', '/api/me/calendar-feed'])(
    'delivers a committed %s response before switching language',
    async (path) => {
      const session = await import('../../client/src/lib/session')
      const { requestContext } = await import('../../client/src/lib/requestContext')
      const { post } = await import('../../client/src/lib/api')
      const i18n = await import('../../client/src/lib/i18n')
      await session.bootSession()
      requestContext.setSpace('friends')
      let finish!: (value: unknown) => void
      runtime.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const outcomes: unknown[] = []
      const command = post(path).then((result) => {
        outcomes.push({ result, locale: i18n.getLocale() })
      })
      const switchLanguage = i18n.setLocale('en')
      expect(i18n.getLocale()).toBe('zh-CN')
      finish({ statusCode: 200, data: { code: 'created-once', recoveryCode: 'one-time', path: '/feed/synthetic' } })
      await Promise.all([command, switchLanguage])
      expect(outcomes).toEqual([{ result: { code: 'created-once', recoveryCode: 'one-time', path: '/feed/synthetic' }, locale: 'zh-CN' }])
      expect(i18n.getLocale()).toBe('en')
      expect(runtime.request).toHaveBeenCalledTimes(1)
    },
  )
  it.each(['locale', 'profile'])('merges only acknowledged fields when the %s response arrives last', async (last) => {
    runtime.storage.set('couju.token', 'saved-token')
    runtime.request.mockResolvedValue({ statusCode: 200, data: me })
    const session = await import('../../client/src/lib/session')
    const { patch } = await import('../../client/src/lib/api')
    const i18n = await import('../../client/src/lib/i18n')
    await session.bootSession()
    let localeResponse!: (value: unknown) => void
    let profileResponse!: (value: unknown) => void
    runtime.request.mockImplementation(
      (options: any) =>
        new Promise((resolve) => {
          if (options.data.locale) localeResponse = resolve
          else profileResponse = resolve
        }),
    )
    const selection = i18n.setLocale('en')
    await vi.waitFor(() => expect(localeResponse).toBeTypeOf('function'))
    const profile = patch<{ user: User }>('/api/me', { timezone: 'Asia/Shanghai' }).then((res) => session.setUser(res.user, ['timezone']))
    if (last === 'profile') {
      // Profile committed first, but its older full-row response is delivered last.
      localeResponse({ statusCode: 200, data: { user: { ...user, locale: 'en', timezone: 'Asia/Shanghai' } } })
      await selection
      profileResponse({ statusCode: 200, data: { user: { ...user, timezone: 'Asia/Shanghai' } } })
    } else {
      profileResponse({ statusCode: 200, data: { user: { ...user, locale: 'en', timezone: 'Asia/Shanghai' } } })
      await profile
      localeResponse({ statusCode: 200, data: { user: { ...user, locale: 'en' } } })
    }
    await Promise.all([profile, selection])
    expect(session.getSession().user).toMatchObject({ locale: 'en', timezone: 'Asia/Shanghai' })
    expect(JSON.parse(runtime.storage.get('couju.user') as string)).toMatchObject({ locale: 'en', timezone: 'Asia/Shanghai' })
  })
  it('carries a new explicit choice through first-time signup without losing its acknowledgement', async () => {
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    await session.bootSession()
    let finish!: (value: unknown) => void
    runtime.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    runtime.request.mockImplementation(async (options: any) => ({
      statusCode: 200,
      data: options.method === 'PATCH' ? { user: { ...user, locale: options.data.locale } } : me,
    }))
    const signup = session.signupGuest('Saved account')
    const choice = i18n.setLocale('en')
    finish({ statusCode: 200, data: { token: 'new-token', user } })
    await Promise.all([signup, choice])
    expect(session.getSession().user).toMatchObject({ id: user.id, locale: 'en' })
    expect(i18n.getLocale()).toBe('en')
    expect(runtime.request.mock.calls.filter(([o]) => o.method === 'PATCH')).toEqual([
      [expect.objectContaining({ data: { locale: 'en' }, header: expect.objectContaining({ Authorization: 'Bearer new-token' }) })],
    ])
  })
  it.each(['account', 'space'])('keeps %s guards while a language switch waits for a command', async (change) => {
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    const { requestContext } = await import('../../client/src/lib/requestContext')
    const { post } = await import('../../client/src/lib/api')
    await session.bootSession()
    requestContext.setIdentity('old-account')
    requestContext.setSpace('A')
    let finish!: (value: unknown) => void
    runtime.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const command = post('/api/events').catch((e) => e)
    const choice = i18n.setLocale('en')
    if (change === 'account') requestContext.setIdentity('new-account')
    else requestContext.setSpace('B')
    finish({ statusCode: 200, data: { code: 'private-old-space' } })
    expect(await command).toMatchObject({ code: 'stale_context' })
    await choice
    expect(runtime.request).toHaveBeenCalledTimes(1)
    expect(i18n.getLocale()).toBe('zh-CN')
  })
  it('delivers a failed command before switching language without retrying it', async () => {
    const session = await import('../../client/src/lib/session')
    const i18n = await import('../../client/src/lib/i18n')
    const { post } = await import('../../client/src/lib/api')
    await session.bootSession()
    let finish!: (value: unknown) => void
    runtime.request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        }),
    )
    const command = post('/api/me/recovery-code').catch((e) => ({ code: e.code, locale: i18n.getLocale() }))
    const choice = i18n.setLocale('en')
    finish({ statusCode: 403, data: { error: 'forbidden', message: '请先登录' } })
    expect(await command).toEqual({ code: 'forbidden', locale: 'zh-CN' })
    await choice
    expect(i18n.getLocale()).toBe('en')
    expect(runtime.request).toHaveBeenCalledTimes(1)
  })
  it.each(['refreshMe', 'refreshSpaces'] as const)(
    'does not let an older %s read overwrite an acknowledged locale save',
    async (refresh) => {
      runtime.storage.set('couju.token', 'saved-token')
      const legacy = { ...me, spaces: [], user: { ...user, locale: undefined } }
      runtime.request.mockResolvedValue({ statusCode: 200, data: legacy })
      const session = await import('../../client/src/lib/session')
      const i18n = await import('../../client/src/lib/i18n')
      await session.bootSession()
      let finish!: (value: unknown) => void
      runtime.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve
          }),
      )
      const oldRead = session[refresh]()
      // Same-language explicit persistence must also protect the cached row.
      runtime.request.mockResolvedValue({ statusCode: 200, data: { user: { ...user, locale: 'zh-CN', timezone: 'Asia/Shanghai' } } })
      session.setUser({ ...user, timezone: 'Asia/Shanghai' }, ['timezone'])
      await i18n.setLocale('zh-CN')
      finish({ statusCode: 200, data: legacy })
      await oldRead
      expect(session.getSession().user).toMatchObject({ locale: 'zh-CN', timezone: 'Asia/Shanghai' })
      expect(JSON.parse(runtime.storage.get('couju.user') as string)).toMatchObject({ locale: 'zh-CN', timezone: 'Asia/Shanghai' })
    },
  )
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
