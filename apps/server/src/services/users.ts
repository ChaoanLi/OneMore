import {
  guestSignupSchema,
  restoreSchema,
  updateMeSchema,
  type User,
  type UserId,
} from '@couju/core'
import type { Ctx } from './context'
import {
  AppError,
  badRequest,
  conflict,
  hashRecoveryCode,
  hashToken,
  newId,
  newRecoveryCode,
  newToken,
  notFound,
  randomCode,
  toPublic,
  verifyRecoveryCode,
} from '../util'

const AVATARS = ['🦊', '🐼', '🐯', '🐸', '🐧', '🦉', '🐙', '🦄', '🐳', '🐱', '🐶', '🐹', '🐨', '🦁', '🐰']

/**
 * 低门槛身份：只需一个昵称就能获得访客身份（设备上保存登录令牌）。
 * 之后可“绑定持久账号”：MVP 提供恢复码；微信登录待小程序接入。
 */
export function signupGuest(ctx: Ctx, raw: unknown): { token: string; user: User } {
  const input = guestSignupSchema.parse(raw)
  return ctx.store.tx(() => {
    let handle = ''
    for (let i = 0; i < 10; i++) {
      const candidate = `u${randomCode(7, 'abcdefghjkmnpqrstuvwxyz23456789')}`
      if (!ctx.store.getUserByHandle(candidate)) {
        handle = candidate
        break
      }
    }
    if (!handle) throw new AppError(409, 'handle_exhausted', '请稍后再试')
    const user: User = {
      id: newId('u'),
      handle,
      nickname: input.nickname,
      avatar: input.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)]!,
      timezone: input.timezone,
      ...(input.locale ? { locale: input.locale } : {}),
      games: [],
      roles: [],
      account: { kind: 'guest' },
      createdAt: ctx.now().toISOString(),
    }
    ctx.store.saveUser(user)
    const token = newToken()
    ctx.store.createSession(hashToken(token), user.id, ctx.now().toISOString())
    return { token, user }
  })
}

export function userFromToken(ctx: Ctx, token: string | undefined): User | undefined {
  if (!token) return undefined
  const userId = ctx.store.getSessionUserId(hashToken(token))
  return userId ? ctx.store.getUser(userId) : undefined
}

export function updateMe(ctx: Ctx, me: User, raw: unknown): User {
  const input = updateMeSchema.parse(raw)
  return ctx.store.tx(() => {
    const latest = ctx.store.getUser(me.id)
    if (!latest) throw notFound('找不到这个用户')
    if (input.handle && input.handle !== latest.handle) {
      const taken = ctx.store.getUserByHandle(input.handle)
      if (taken && taken.id !== me.id) throw conflict('这个 ID 已被使用', 'handle_taken')
    }
    const next: User = {
      ...latest,
      nickname: input.nickname ?? latest.nickname,
      handle: input.handle ?? latest.handle,
      avatar: input.avatar ?? latest.avatar,
      timezone: input.timezone ?? latest.timezone,
      ...(input.locale ? { locale: input.locale } : {}),
      games: input.myGames ? input.myGames.flatMap((g) => (g.gameKey ? [g.gameKey] : [])) : (input.games ?? latest.games),
      myGames: input.myGames ?? latest.myGames,
      roles: input.roles ?? latest.roles,
    }
    ctx.store.saveUser(next)
    return next
  })
}

/** 生成（或重新生成）恢复码。明文只返回这一次。 */
export function bindRecoveryCode(ctx: Ctx, me: User): { recoveryCode: string; user: User } {
  const code = newRecoveryCode()
  return ctx.store.tx(() => {
    ctx.store.setRecovery(me.id, hashRecoveryCode(code), ctx.now().toISOString())
    const user: User = { ...me, account: { kind: 'bound', method: 'recovery_code', boundAt: ctx.now().toISOString() } }
    ctx.store.saveUser(user)
    return { recoveryCode: code, user }
  })
}

export function restoreWithCode(ctx: Ctx, raw: unknown): { token: string; user: User } {
  const input = restoreSchema.parse(raw)
  const user = ctx.store.getUserByHandle(input.handle)
  const stored = user ? ctx.store.getRecoveryHash(user.id) : undefined
  // 统一错误信息，避免探测哪些 ID 存在
  if (!user || !stored || !verifyRecoveryCode(input.recoveryCode, stored)) {
    throw badRequest('ID 或恢复码不正确', 'invalid_recovery')
  }
  const token = newToken()
  ctx.store.createSession(hashToken(token), user.id, ctx.now().toISOString())
  return { token, user }
}

export function publicProfile(ctx: Ctx, handle: string) {
  const u = ctx.store.getUserByHandle(handle)
  if (!u || !ctx.store.isMember(u.id)) throw notFound('找不到这个用户')
  return toPublic(u)
}

export function requireUsers(ctx: Ctx, ids: UserId[]) {
  return new Map(ctx.store.getUsers(ids).map((u) => [u.id, u]))
}
