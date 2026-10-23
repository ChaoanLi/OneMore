import Taro from '@tarojs/taro'
import { useEffect, useReducer } from 'react'
import { DEFAULT_TIMEZONE, isValidTimeZone, type AuthResponse, type MeResponse, type User } from '@couju/core'
import { ApiError, get, post, setApiToken } from './api'

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
}

let state: SessionState = { ready: false, user: null, unread: 0 }
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
      } catch {
        // 缓存损坏时忽略
      }
    }
    try {
      const me = await get<MeResponse>('/api/me')
      setState({ ready: true, user: me.user, unread: me.unread })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        clearLocal()
        setState({ ready: true, user: null, unread: 0 })
      } else {
        // 离线时先用缓存
        setState({ ready: true })
      }
    }
  })()
  return booting
}

function saveAuth(res: AuthResponse) {
  Taro.setStorageSync(TOKEN_KEY, res.token)
  setApiToken(res.token)
  setState({ ready: true, user: res.user, unread: 0 })
}

function clearLocal() {
  Taro.removeStorageSync(TOKEN_KEY)
  Taro.removeStorageSync(USER_KEY)
  setApiToken(null)
}

export async function signupGuest(nickname: string, timezone = DEFAULT_TIMEZONE): Promise<User> {
  const res = await post<AuthResponse>('/api/auth/guest', { nickname, timezone })
  saveAuth(res)
  return res.user
}

export async function restoreAccount(handle: string, recoveryCode: string): Promise<User> {
  const res = await post<AuthResponse>('/api/auth/restore', { handle, recoveryCode })
  saveAuth(res)
  return res.user
}

export function setUser(user: User) {
  setState({ user })
}

export async function refreshMe() {
  if (!state.user) return
  try {
    const me = await get<MeResponse>('/api/me')
    setState({ user: me.user, unread: me.unread })
  } catch {
    // 忽略刷新失败
  }
}

export function setUnread(unread: number) {
  setState({ unread })
}

export function logout() {
  clearLocal()
  setState({ user: null, unread: 0 })
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
