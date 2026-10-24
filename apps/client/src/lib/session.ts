import Taro from '@tarojs/taro'
import { useEffect, useReducer } from 'react'
import { DEFAULT_TIMEZONE, isValidTimeZone, type AuthResponse, type MeResponse, type User, type SpaceSummary } from '@couju/core'
import { requestContext } from './requestContext'
import { ApiError, get, post, patch, setApiToken } from './api'
import { applyLocale, getLocale, setLocalePersistence, t } from './i18n'

/**
 * 会话：本地保存访客令牌（couju.token）与用户资料缓存（couju.user）。
 * 没有注册流程：第一次需要身份时弹出“怎么称呼你”，填昵称即可。
 */
const TOKEN_KEY = 'couju.token'
const USER_KEY = 'couju.user'

interface SessionState {
  ready: boolean
  user: User | null
  unread: number
  spaces: SpaceSummary[]
  activeSpace: string | null
  revision: number
  switching: boolean
}

let state: SessionState = { ready: false, user: null, unread: 0, spaces: [], activeSpace: null, revision: 0, switching: false }
const listeners = new Set<() => void>()

function setState(patch: Partial<SessionState>) {
  state = { ...state, ...patch }
  if (patch.user !== undefined) {
    if (patch.user) Taro.setStorageSync(USER_KEY, JSON.stringify(patch.user))
    else Taro.removeStorageSync(USER_KEY)
  }
  listeners.forEach((l) => l())
}

export function useSession(): SessionState {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    listeners.add(force)
    return () => {
      listeners.delete(force)
    }
  }, [])
  return state
}

export function getSession() {
  return state
}

/** 设备所在时区，只用于提示“要不要改成设备时区”；默认一律用北京时间 */
export function deviceTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz && isValidTimeZone(tz)) return tz
  } catch {
    // 部分小程序环境不支持 Intl 时区
  }
  return DEFAULT_TIMEZONE
}

let booting: Promise<void> | null = null

export function bootSession(): Promise<void> {
  if (booting) return booting
  booting = (async () => {
    const token = Taro.getStorageSync(TOKEN_KEY) as string
    const cached = Taro.getStorageSync(USER_KEY) as string
    if (!token) {
      setState({ ready: true, user: null })
      return
    }
    setApiToken(token)
    if (cached) {
      try {
        state = { ...state, user: JSON.parse(cached) as User }
        if (state.user?.locale) applyLocale(state.user.locale)
      } catch {
        // 缓存损坏时忽略
      }
    }
    const context = requestContext.capture()
    while (requestContext.sameContent(context)) {
      try {
        const me = await get<MeResponse>('/api/me')
        if (!requestContext.sameContent(context)) return
        if (me.user.locale) applyLocale(me.user.locale)
        applySpaces(me.spaces, me.user)
        setState({ ready: true, user: me.user, unread: 0 })
        return
      } catch (e) {
        // 仅语言变化可重试；身份或空间替换后不得恢复旧会话。
        if (!requestContext.sameContent(context)) return
        if (e instanceof ApiError && e.code === 'stale_context') continue
        if (e instanceof ApiError && e.status === 401) {
          clearLocal()
          setState({ ready: true, user: null, unread: 0 })
        } else {
          // 离线时先用缓存
          setState({ ready: true })
        }
        return
      }
    }
  })()
  return booting
}

function saveAuth(res: AuthResponse) {
  Taro.setStorageSync(TOKEN_KEY, res.token)
  setApiToken(res.token)
  if (res.user.locale) applyLocale(res.user.locale)
  setState({ ready: true, user: res.user, unread: 0, spaces: [], activeSpace: null, revision: state.revision + 1 })
}

function clearLocal() {
  Taro.removeStorageSync(TOKEN_KEY)
  Taro.removeStorageSync(USER_KEY)
  setApiToken(null)
}

export async function signupGuest(nickname: string, timezone = DEFAULT_TIMEZONE): Promise<User> {
  const res = await post<AuthResponse>('/api/auth/guest', { nickname, timezone, locale: getLocale() })
  saveAuth(res)
  await refreshSpaces()
  return res.user
}

export async function restoreAccount(handle: string, recoveryCode: string): Promise<User> {
  const res = await post<AuthResponse>('/api/auth/restore', { handle, recoveryCode })
  setState({ switching: true })
  saveAuth(res)
  await refreshSpaces()
  try {
    await Taro.reLaunch({ url: '/pages/me/index' })
  } finally {
    setState({ switching: false })
  }
  return res.user
}

export function setUser(user: User) {
  setState({ user })
}

export async function refreshMe() {
  if (!state.user) return
  try {
    const me = await get<MeResponse>('/api/me')
    applySpaces(me.spaces, me.user)
    setState({ user: me.user })
    if (state.activeSpace) {
      const n = await get<{ unread: number }>('/api/notifications')
      setState({ unread: n.unread })
    }
  } catch {
    // 忽略刷新失败
  }
}

export function setUnread(unread: number) {
  setState({ unread })
}

export function logout() {
  clearLocal()
  void Taro.reLaunch({ url: '/pages/me/index' })
  setState({ user: null, unread: 0, spaces: [], activeSpace: null, revision: state.revision + 1 })
}

function applySpaces(spaces: SpaceSummary[], user: User) {
  const key = `onemore.space.${user.id}`
  const saved = Taro.getStorageSync(key) as string
  const previous = state.activeSpace
  const active = spaces.some((s) => s.id === state.activeSpace)
    ? state.activeSpace
    : (spaces.find((s) => s.id === saved)?.id ?? spaces[0]?.id ?? null)
  requestContext.setSpace(active)
  setState({ spaces, activeSpace: active, revision: active !== state.activeSpace ? state.revision + 1 : state.revision })
  if (active) Taro.setStorageSync(key, active)
  if (previous && previous !== active) {
    setState({ switching: true, unread: 0 })
    void Taro.reLaunch({ url: '/pages/index/index' }).finally(() => setState({ switching: false }))
  }
}
export async function refreshSpaces() {
  const me = await get<MeResponse>('/api/me')
  applySpaces(me.spaces, me.user)
  setState({ user: me.user })
}
export async function selectSpace(id: string, url = '/pages/index/index') {
  if (!state.spaces.some((s) => s.id === id)) {
    await refreshSpaces()
    if (!state.spaces.some((s) => s.id === id)) throw new ApiError(403, 'forbidden', t('你还不是这个空间的成员'))
  }
  requestContext.setSpace(id)
  setState({ activeSpace: id, unread: 0, revision: state.revision + 1, switching: true })
  Taro.setStorageSync(`onemore.space.${state.user!.id}`, id)
  try {
    await Taro.reLaunch({ url })
  } finally {
    setState({ switching: false })
  }
}

// ---------- 需要身份时弹出“怎么称呼你” ----------

interface IdentityRequest {
  reason: string
  resolve: (u: User | null) => void
}
let identityRequest: IdentityRequest | null = null
const identityListeners = new Set<() => void>()

/** 已有身份直接返回；否则弹出昵称输入，用户取消返回 null */
export async function requireUser(reason = '先告诉大家怎么称呼你'): Promise<User | null> {
  await bootSession()
  if (state.user) return state.user
  return new Promise((resolve) => {
    identityRequest = { reason, resolve }
    identityListeners.forEach((l) => l())
  })
}

setLocalePersistence(async (locale) => {
  if (!state.user) return
  const res = await patch<{ user: User }>('/api/me', { locale })
  setUser(res.user)
})

export function useIdentityRequest() {
  const [, force] = useReducer((x: number) => x + 1, 0)
  useEffect(() => {
    identityListeners.add(force)
    return () => {
      identityListeners.delete(force)
    }
  }, [])
  return {
    request: identityRequest,
    finish(user: User | null) {
      const r = identityRequest
      identityRequest = null
      identityListeners.forEach((l) => l())
      r?.resolve(user)
    },
  }
}
