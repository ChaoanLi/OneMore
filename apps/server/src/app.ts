import { Hono, type Context } from 'hono'
import { cors } from 'hono/cors'
import { ZodError } from 'zod'
import { aiDraftRequestSchema, GAME_CATALOG, type User } from '@couju/core'
import type { Ctx } from './services/context'
import type { Store } from './store'
import { AppError, MemoryRateLimiter, hashToken } from './util'
import * as users from './services/users'
import * as spaces from './services/spaces'
import * as social from './services/social'
import * as events from './services/events'
import * as interests from './services/interests'
import * as notifications from './services/notify'
import { draftFromText, providerFromEnv, type DraftProvider } from './ai/providers'
import * as calendar from './services/calendar'
import * as email from './services/email'
import { Mailer, transportFromEnv } from './services/mailer'

const APP_NAME = '算我一个 · OneMore'

type Env = { Variables: { user: User | undefined; ctx: Ctx; membershipGeneration: string | undefined } }

export interface AppDeps {
  store: Store
  now?: () => Date
  ai?: DraftProvider
  mailer?: Mailer
}

export function createApp(deps: AppDeps) {
  const now = deps.now ?? (() => new Date())
  const baseUrl = (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 8787}`).replace(/\/$/, '')
  const ctx: Ctx = { store: deps.store, now, mailer: deps.mailer ?? new Mailer(deps.store, transportFromEnv(), now, baseUrl) }
  const ai = deps.ai ?? providerFromEnv()
  const signupLimiter = new MemoryRateLimiter(30, 3600_000)
  const restoreLimiter = new MemoryRateLimiter(5, 15 * 60_000)
  const aiLimiter = new MemoryRateLimiter(10, 60_000)

  const app = new Hono<Env>()

  // Bearer token，不使用 Cookie，因此允许跨域（方便本地调试与小程序）
  app.use('/api/*', cors())

  app.use('/api/*', async (c, next) => {
    const auth = c.req.header('Authorization')
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined
    const user = users.userFromToken(ctx, token)
    c.set('user', user)
    c.set('ctx', ctx)
    c.set('membershipGeneration', undefined)
    const path = c.req.path
    const global =
      path.startsWith('/api/auth/') ||
      path === '/api/me' ||
      path === '/api/me/recovery-code' ||
      path === '/api/spaces' ||
      path.startsWith('/api/spaces/') ||
      path.startsWith('/api/space-invites/') ||
      path.startsWith('/api/email/unsubscribe/') ||
      path.startsWith('/api/calendar/feed/') ||
      ['/api/health', '/api/games', '/api/ai/status', '/api/email/status'].includes(path)
    if (!global) {
      if (!user) throw new AppError(401, 'unauthorized', '请先登录并加入空间')
      const spaceId = c.req.header('X-Space-Id')
      if (!spaceId) throw new AppError(400, 'space_required', '请先选择空间')
      const membership = spaces.requireMember(ctx, user, spaceId)
      c.set('membershipGeneration', membership.generation)
      c.set('ctx', { ...ctx, store: deps.store.forSpace(spaceId) })
    }
    await next()
  })

  const me = (c: Context<Env>): User => {
    const u = c.get('user')
    if (!u) throw new AppError(401, 'unauthorized', '请先告诉我们怎么称呼你')
    return u
  }
  const scoped = (c: Context<Env>): Ctx => c.get('ctx')
  const body = async (c: Context<Env>) => {
    let input: unknown
    try {
      input = await c.req.json()
    } catch {
      input = {}
    }
    // Reading a streamed body yields control: authorization may have been revoked or replaced.
    const spaceId = scoped(c).store.spaceId
    if (spaceId) {
      const membership = spaces.requireMember(ctx, me(c), spaceId)
      if (membership.generation !== c.get('membershipGeneration'))
        throw new AppError(403, 'membership_changed', '成员资格已变更，请重新打开页面')
    }
    return input
  }
  const ip = (c: Context<Env>) => c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'local'

  app.onError((err, c) => {
    if (err instanceof AppError) return c.json({ error: err.code, message: err.message }, err.status)
    if (err instanceof ZodError) {
      const issue = err.issues[0]
      return c.json({ error: 'invalid_input', message: issue?.message ?? '输入有误', path: issue?.path }, 400)
    }
    console.error(err)
    return c.json({ error: 'internal', message: '服务器开小差了，请稍后再试' }, 500)
  })

  app.get('/api/health', (c) => c.json({ ok: true, ai: ai.name, time: scoped(c).now().toISOString() }))
  app.get('/api/games', (c) => c.json({ games: GAME_CATALOG }))

  // ---------- 身份 ----------
  app.post('/api/auth/guest', async (c) => {
    if (!signupLimiter.check(ip(c))) throw new AppError(429, 'rate_limited', '操作太频繁，请稍后再试')
    return c.json(users.signupGuest(scoped(c), await body(c)))
  })
  app.post('/api/auth/restore', async (c) => {
    if (!restoreLimiter.check(ip(c))) throw new AppError(429, 'rate_limited', '尝试次数太多，请 15 分钟后再试')
    return c.json(users.restoreWithCode(scoped(c), await body(c)))
  })
  app.post('/api/auth/wechat', () => {
    throw new AppError(501, 'not_implemented', '微信登录尚未接入（需要小程序 AppID 与后端 code2Session）')
  })
  app.get('/api/me', (c) => c.json({ user: me(c), spaces: ctx.store.listSpaces(me(c).id), unread: 0 }))
  app.patch('/api/me', async (c) => c.json({ user: users.updateMe(scoped(c), me(c), await body(c)) }))
  app.post('/api/me/recovery-code', (c) => c.json(users.bindRecoveryCode(scoped(c), me(c))))
  app.get('/api/users/:handle', (c) => c.json({ user: users.publicProfile(scoped(c), c.req.param('handle')) }))

  // ---------- 空间 ----------
  app.get('/api/spaces', (c) => c.json({ spaces: ctx.store.listSpaces(me(c).id) }))
  app.post('/api/spaces', async (c) => c.json(spaces.createSpace(ctx, me(c), await body(c))))
  app.get('/api/spaces/:id/members', (c) => c.json(spaces.memberList(ctx, me(c), c.req.param('id'))))
  app.post('/api/spaces/:id/invite', (c) => c.json(spaces.rotateInvite(ctx, me(c), c.req.param('id'))))
  app.get('/api/space-invites/:token', (c) => c.json(spaces.invitePreview(ctx, c.req.param('token'), c.get('user'))))
  app.post('/api/space-invites/:token/requests', (c) => c.json(spaces.requestJoin(ctx, me(c), c.req.param('token'))))
  app.get('/api/spaces/:id/requests', (c) => c.json(spaces.requests(ctx, me(c), c.req.param('id'))))
  app.post('/api/spaces/:id/requests/:request/approve', (c) =>
    c.json(spaces.decideRequest(ctx, me(c), c.req.param('id'), c.req.param('request'), true)),
  )
  app.post('/api/spaces/:id/requests/:request/reject', (c) =>
    c.json(spaces.decideRequest(ctx, me(c), c.req.param('id'), c.req.param('request'), false)),
  )
  app.post('/api/spaces/:id/leave', (c) => c.json(spaces.removeMember(ctx, me(c), c.req.param('id'), me(c).id)))
  app.delete('/api/spaces/:id/members/:user', (c) => c.json(spaces.removeMember(ctx, me(c), c.req.param('id'), c.req.param('user'))))

  // ---------- 好友与圈子 ----------
  app.get('/api/friends', (c) => c.json(social.listFriends(scoped(c), me(c))))
  app.post('/api/friends', async (c) => c.json(social.requestFriend(scoped(c), me(c), await body(c))))
  app.post('/api/friends/:id/accept', (c) => {
    social.acceptFriend(scoped(c), me(c), c.req.param('id'))
    return c.json({ ok: true })
  })
  app.patch('/api/friends/:id', async (c) => {
    social.setFavorite(scoped(c), me(c), c.req.param('id'), await body(c))
    return c.json({ ok: true })
  })
  app.delete('/api/friends/:id', (c) => {
    social.removeFriend(scoped(c), me(c), c.req.param('id'))
    return c.json({ ok: true })
  })
  app.get('/api/circles', (c) => c.json({ circles: social.listCircles(scoped(c), me(c)) }))
  app.post('/api/circles', async (c) => c.json({ circle: social.createCircle(scoped(c), me(c), await body(c)) }))
  app.put('/api/circles/:id', async (c) => c.json({ circle: social.updateCircle(scoped(c), me(c), c.req.param('id'), await body(c)) }))
  app.delete('/api/circles/:id', (c) => {
    social.deleteCircle(scoped(c), me(c), c.req.param('id'))
    return c.json({ ok: true })
  })

  // ---------- 活动 ----------
  app.get('/api/events', (c) => c.json(events.listMyEvents(scoped(c), me(c))))
  app.post('/api/events', async (c) => {
    const e = events.createEvent(scoped(c), me(c), await body(c))
    return c.json({ code: e.code })
  })
  // 活动链接仅供当前空间已加入成员使用。
  app.get('/api/events/:code', (c) =>
    c.json(events.getEventView(scoped(c), c.req.param('code'), c.get('user'), c.req.query('tz') || undefined)),
  )
  const action = (fn: (c: Context<Env>, user: User, code: string, input: unknown) => unknown) => async (c: Context<Env>) => {
    const user = me(c)
    const code = c.req.param('code')!
    const result = fn(c, user, code, await body(c))
    return c.json({ ...(typeof result === 'object' && result ? result : {}), view: events.getEventView(scoped(c), code, user) })
  }
  app.put(
    '/api/events/:code/response',
    action((c, u, code, input) => events.respond(scoped(c), u, code, input)),
  )
  app.post(
    '/api/events/:code/withdraw',
    action((c, u, code) => events.withdraw(scoped(c), u, code)),
  )
  app.post(
    '/api/events/:code/final-confirm',
    action((c, u, code) => events.finalConfirm(scoped(c), u, code)),
  )
  app.post(
    '/api/events/:code/confirm',
    action((c, u, code, input) => events.confirmEvent(scoped(c), u, code, input)),
  )
  app.post(
    '/api/events/:code/promote',
    action((c, u, code, input) => events.promoteWaitlist(scoped(c), u, code, input)),
  )
  app.post(
    '/api/events/:code/reopen',
    action((c, u, code) => events.reopenEvent(scoped(c), u, code)),
  )
  app.post(
    '/api/events/:code/cancel',
    action((c, u, code, input) => events.cancelEvent(scoped(c), u, code, input)),
  )
  app.post(
    '/api/events/:code/invite',
    action((c, u, code, input) => events.inviteMore(scoped(c), u, code, input)),
  )
  app.post(
    '/api/events/:code/slots',
    action((c, u, code, input) => events.addSlots(scoped(c), u, code, input)),
  )

  // ---------- 我想玩 ----------
  app.get('/api/interests', (c) => c.json(interests.listInterests(scoped(c), me(c))))
  app.post('/api/interests', async (c) => c.json({ interest: interests.createInterest(scoped(c), me(c), await body(c)) }))
  app.post('/api/interests/:id/join', (c) => c.json({ interest: interests.joinInterest(scoped(c), me(c), c.req.param('id')) }))
  app.delete('/api/interests/:id/join', (c) => c.json({ interest: interests.leaveInterest(scoped(c), me(c), c.req.param('id')) }))
  app.post('/api/interests/:id/withdraw', (c) => {
    interests.withdrawInterest(scoped(c), me(c), c.req.param('id'))
    return c.json({ ok: true })
  })

  // ---------- 邮件 ----------
  app.get('/api/email/status', (c) => c.json({ transport: scoped(c).mailer?.transport.kind ?? 'console' }))
  app.get('/api/me/email', (c) => c.json(email.emailSettings(scoped(c), me(c))))
  app.post('/api/me/email', async (c) => c.json(email.requestEmail(scoped(c), me(c), await body(c))))
  app.post('/api/me/email/verify', async (c) => c.json(email.verifyEmail(scoped(c), me(c), await body(c))))
  app.patch('/api/me/email', async (c) => c.json(email.setEmailEnabled(scoped(c), me(c), await body(c))))
  app.delete('/api/me/email', (c) => c.json(email.removeEmail(scoped(c), me(c))))
  app.post('/api/events/:code/email-invite', async (c) => c.json(email.inviteByEmail(scoped(c), me(c), c.req.param('code'), await body(c))))
  // 邮件里的一键退订：返回一个简单页面
  app.get('/api/email/unsubscribe/:token', (c) => {
    try {
      const addr = email.unsubscribe(scoped(c), c.req.param('token'))
      return c.html(
        `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:-apple-system,'PingFang SC',sans-serif;max-width:420px;margin:60px auto;padding:0 20px;color:#1f1f1f"><div style="color:#ff2b2b;font-weight:800">算我一个 · OneMore</div><h2>已退订</h2><p style="color:#6b6b6b">${addr.replace(/[<>&"]/g, '')} 之后不会再收到任何邮件。想重新接收，在 App 的“我”里重新验证邮箱即可。</p></body>`,
      )
    } catch {
      return c.html('<!doctype html><meta charset="utf-8"><p>退订链接无效。</p>', 404)
    }
  })

  // ---------- 日历 ----------
  app.get('/api/calendar', (c) => c.json(calendar.calendarMonth(scoped(c), me(c), c.req.query('month'))))
  app.get('/api/me/calendar-feed', (c) => c.json(calendar.feedStatus(scoped(c), me(c))))
  app.post('/api/me/calendar-feed', (c) => c.json(calendar.rotateFeed(scoped(c), me(c))))
  app.delete('/api/me/calendar-feed', (c) => c.json(calendar.disableFeed(scoped(c), me(c))))
  // 日历应用订阅用：不能带请求头，所以令牌在链接里（只读、可随时重新生成作废）
  app.get('/api/calendar/feed/:file', (c) => {
    const token = c.req.param('file').replace(/\.ics$/, '')
    const proto = c.req.header('x-forwarded-proto') ?? new URL(c.req.url).protocol.replace(':', '')
    const host = c.req.header('x-forwarded-host') ?? c.req.header('host') ?? new URL(c.req.url).host
    const baseUrl = (process.env.PUBLIC_URL || `${proto}://${host}`).replace(/\/$/, '')
    const feed = ctx.store.resolveCalendarFeed(hashToken(token))
    if (!feed) throw new AppError(404, 'not_found', '订阅链接无效')
    const body = calendar.buildFeed({ ...ctx, store: ctx.store.forSpace(feed.spaceId) }, token, baseUrl, APP_NAME)
    return c.body(body, 200, {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="onemore.ics"',
      'Cache-Control': 'no-cache',
    })
  })

  // ---------- 通知 ----------
  app.get('/api/notifications', (c) => c.json(notifications.listNotifications(scoped(c), me(c).id)))
  app.post('/api/notifications/read', (c) => {
    notifications.markAllRead(scoped(c), me(c).id)
    return c.json({ ok: true })
  })

  // ---------- AI 草稿 ----------
  app.get('/api/ai/status', (c) => c.json({ provider: ai.name }))
  app.post('/api/ai/draft', async (c) => {
    const user = me(c)
    if (!aiLimiter.check(user.id)) throw new AppError(429, 'rate_limited', '说得太快啦，歇一会儿再试')
    const { text } = aiDraftRequestSchema.parse(await body(c))
    return c.json(await draftFromText(ai, text, { now: scoped(c).now(), timezone: user.timezone }))
  })

  return { app, ctx }
}
