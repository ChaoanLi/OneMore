import { z } from 'zod'
import { guestSignupSchema, type User } from '@couju/core'
import type { Ctx } from './context'
import { signupGuest } from './users'
import { AppError, badRequest, conflict, hashToken, newToken } from '../util'

/**
 * 微信小程序登录：小程序端 wx.login() 拿到一次性 code，服务端换成 openid。
 * 一个 openid 只对应一个账号；账号原有的恢复码不受影响。
 */
export interface WechatAuth {
  code2Session(code: string): Promise<{ openid: string }>
}

/** 读取 WECHAT_APPID / WECHAT_SECRET；没配置时返回 undefined（接口返回 501）。 */
export function wechatFromEnv(env = process.env): WechatAuth | undefined {
  const appid = env.WECHAT_APPID?.trim()
  const secret = env.WECHAT_SECRET?.trim()
  if (!appid || !secret) return undefined
  return {
    async code2Session(code) {
      const url = new URL('https://api.weixin.qq.com/sns/jscode2session')
      url.search = new URLSearchParams({ appid, secret, js_code: code, grant_type: 'authorization_code' }).toString()
      let data: { openid?: string; errcode?: number; errmsg?: string }
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        data = (await res.json()) as typeof data
      } catch {
        throw new AppError(502, 'wechat_unreachable', '暂时连不上微信，请稍后再试')
      }
      if (!data.openid) {
        // 40029 = code 无效或已用过；其他错误不把 errmsg 透给客户端
        if (data.errcode === 40029 || data.errcode === 40163) throw badRequest('微信登录已过期，请重试', 'invalid_wechat_code')
        console.error('jscode2session failed', data.errcode, data.errmsg)
        throw new AppError(502, 'wechat_error', '微信登录失败，请稍后再试')
      }
      return { openid: data.openid }
    },
  }
}

export const wechatLoginSchema = z.object({
  code: z.string().trim().min(1).max(200),
  /** 没绑定过的新用户第一次登录时一起提交昵称等资料 */
  profile: guestSignupSchema.optional(),
})

export type WechatLoginResult =
  | { status: 'signed_in'; token: string; user: User }
  | { status: 'bound'; user: User }
  | { status: 'needs_profile' }

/**
 * - openid 已绑定：签发新令牌，直接登录。
 * - 未绑定、请求带着已登录账号：把 openid 绑到这个账号（H5 老账号用恢复码找回后走这里）。
 * - 未绑定、带了资料：新建访客账号并绑定。
 * - 都没有：告诉客户端需要先填昵称。
 */
export async function loginWithWechat(ctx: Ctx, auth: WechatAuth, current: User | undefined, raw: unknown): Promise<WechatLoginResult> {
  const input = wechatLoginSchema.parse(raw)
  const { openid } = await auth.code2Session(input.code)
  const bind = (userId: string) =>
    ctx.store.tx(() => {
      const boundUserId = ctx.store.getUserIdByOpenid(openid)
      if (boundUserId === userId) return
      if (boundUserId) throw conflict('这个微信已经绑定了另一个账号', 'wechat_bound_elsewhere')
      if (ctx.store.getOpenidByUserId(userId)) throw conflict('这个账号已经绑定了另一个微信', 'account_bound_elsewhere')
      ctx.store.bindOpenid(openid, userId, ctx.now().toISOString())
    })

  if (current) {
    bind(current.id)
    return { status: 'bound', user: current }
  }
  const signedIn = ctx.store.tx((): WechatLoginResult | undefined => {
    const boundUserId = ctx.store.getUserIdByOpenid(openid)
    const user = boundUserId ? ctx.store.getUser(boundUserId) : undefined
    if (!user) return undefined
    const token = newToken()
    ctx.store.createSession(hashToken(token), user.id, ctx.now().toISOString())
    return { status: 'signed_in', token, user }
  })
  if (signedIn) return signedIn
  if (!input.profile) return { status: 'needs_profile' }
  const created = signupGuest(ctx, input.profile)
  bind(created.user.id)
  return { status: 'signed_in', ...created }
}
