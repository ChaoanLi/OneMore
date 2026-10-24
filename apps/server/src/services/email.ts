import { createHash, randomInt } from 'node:crypto'
import {
  DEFAULT_TIMEZONE,
  emailInviteSchema,
  emailRequestSchema,
  emailToggleSchema,
  emailVerifySchema,
  slotInOtherZone,
  slotOneLine,
  zoneLabel,
  type AppNotification,
  type EmailInviteResponse,
  type EmailSettingsResponse,
  type User,
  type UserId,
} from '@couju/core'
import type { Ctx } from './context'
import type { UserEmailRecord } from '../store'
import { AppError, badRequest, forbidden, newToken, notFound } from '../util'
import { renderEmail } from './mailer'

/**
 * 邮件提醒：
 * - 用户自己留邮箱并验证后，站内通知会同时发邮件（沿用通知的频率限制 + 夜间免打扰）。
 * - 组局人可以用邮件邀请还没用过 App 的朋友：每封都能一键退订，退订地址不再收到任何邮件；有发送上限防滥用。
 * - 邮箱只有本人可见，不会展示给其他人。
 */

const CODE_TTL_MS = 15 * 60_000
const MAX_CODE_ATTEMPTS = 5
const MAX_CODES_PER_HOUR = 5
const HOST_INVITES_PER_DAY = 30
const ADDRESS_INVITES_PER_DAY = 3
const DAY = 24 * 3600_000

function mailer(ctx: Ctx) {
  if (!ctx.mailer) throw new AppError(501, 'mail_disabled', '邮件功能没有启用')
  return ctx.mailer
}

function blank(userId: UserId): UserEmailRecord {
  return { userId, email: null, enabled: false, verifiedAt: null, pendingEmail: null, codeHash: null, codeExpiresAt: null, codeAttempts: 0, codeSentAt: [] }
}

const codeHash = (userId: UserId, code: string) => createHash('sha256').update(`${userId}:${code}`).digest('hex')

function settings(ctx: Ctx, rec: UserEmailRecord, devCode?: string): EmailSettingsResponse {
  const kind = ctx.mailer?.transport.kind ?? 'console'
  return {
    email: rec.email,
    enabled: rec.enabled && !!rec.email && !!ctx.store.getMembership(ctx.store.spaceId!,rec.userId)?.emailEnabled && !ctx.store.isSuppressed(rec.email),
    pending: rec.pendingEmail,
    transport: kind,
    ...(devCode && kind === 'console' && process.env.NODE_ENV !== 'production' ? { devCode } : {}),
  }
}

function unsubUrl(ctx: Ctx, email: string): string {
  const token = ctx.store.unsubToken(email, newToken)
  return `${mailer(ctx).baseUrl}/api/email/unsubscribe/${token}`
}

export function emailSettings(ctx: Ctx, me: User): EmailSettingsResponse {
  return settings(ctx, ctx.store.getUserEmail(me.id) ?? blank(me.id))
}

/** 发送验证码（演示模式下直接返回验证码） */
export function requestEmail(ctx: Ctx, me: User, raw: unknown): EmailSettingsResponse {
  const { email } = emailRequestSchema.parse(raw)
  const now = ctx.now()
  const rec = ctx.store.getUserEmail(me.id) ?? blank(me.id)
  const recent = rec.codeSentAt.filter((t) => now.getTime() - Date.parse(t) < 3600_000)
  if (recent.length >= MAX_CODES_PER_HOUR) throw new AppError(429, 'rate_limited', '验证码发得太频繁了，一小时后再试')
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const next: UserEmailRecord = {
    ...rec,
    pendingEmail: email,
    codeHash: codeHash(me.id, code),
    codeExpiresAt: new Date(now.getTime() + CODE_TTL_MS).toISOString(),
    codeAttempts: 0,
    codeSentAt: [...recent, now.toISOString()],
  }
  ctx.store.saveUserEmail(next)
  const body = renderEmail({
    heading: `你的验证码：${code}`,
    lines: [`${me.nickname}，在「算我一个」里输入这 6 位数字，就能收到成团、差一个人之类的邮件提醒。`, '15 分钟内有效。不是你本人操作的话，忽略这封邮件就好。'],
    footer: '这封邮件由「算我一个 · OneMore」自动发送。',
  })
  mailer(ctx).enqueue({ to: email, subject: `【算我一个】验证码 ${code}`, ...body, kind: 'verify' }, { immediate: true })
  return settings(ctx, next, code)
}

export function verifyEmail(ctx: Ctx, me: User, raw: unknown): EmailSettingsResponse {
  const { code } = emailVerifySchema.parse(raw)
  const rec = ctx.store.getUserEmail(me.id)
  if (!rec?.pendingEmail || !rec.codeHash || !rec.codeExpiresAt) throw badRequest('先填邮箱、收验证码')
  if (Date.parse(rec.codeExpiresAt) < ctx.now().getTime()) throw badRequest('验证码过期了，重新发一个吧', 'code_expired')
  if (rec.codeAttempts >= MAX_CODE_ATTEMPTS) throw badRequest('错太多次了，重新发一个验证码吧', 'too_many_attempts')
  if (codeHash(me.id, code) !== rec.codeHash) {
    ctx.store.saveUserEmail({ ...rec, codeAttempts: rec.codeAttempts + 1 })
    throw badRequest('验证码不对', 'wrong_code')
  }
  const email = rec.pendingEmail
  const next: UserEmailRecord = { ...rec, email, enabled: true, verifiedAt: ctx.now().toISOString(), pendingEmail: null, codeHash: null, codeExpiresAt: null, codeAttempts: 0 }
  ctx.store.saveUserEmail(next)
  // 用户主动验证 = 明确同意接收，解除之前的退订
  ctx.store.unsuppress(email)
  return settings(ctx, next)
}

export function setEmailEnabled(ctx: Ctx, me: User, raw: unknown): EmailSettingsResponse {
  const { enabled } = emailToggleSchema.parse(raw)
  const rec = ctx.store.getUserEmail(me.id)
  if (!rec?.email) throw badRequest('还没有验证过的邮箱')
  const member=ctx.store.getMembership(ctx.store.spaceId!,me.id)!
  ctx.store.saveMembership({...member,emailEnabled:enabled})
  return settings(ctx, rec)
}

export function removeEmail(ctx: Ctx, me: User): EmailSettingsResponse {
  ctx.store.deleteUserEmail(me.id)
  return settings(ctx, blank(me.id))
}

/** 站内通知的同时发邮件（由 notify() 调用；频率限制已在 notify 里做过） */
export function notificationEmail(ctx: Ctx, n: AppNotification) {
  if (!ctx.mailer) return
  const rec = ctx.store.getUserEmail(n.userId)
  if (!rec?.email || !rec.enabled || !ctx.store.getMembership(ctx.store.spaceId!,n.userId)?.emailEnabled || ctx.store.isSuppressed(rec.email)) return
  const user = ctx.store.getUser(n.userId)
  const link = `${ctx.mailer.baseUrl}/#${n.link}`
  const body = renderEmail({
    heading: `[${ctx.store.getSpace(ctx.store.spaceId!)!.name}] ${n.title}`,
    lines: n.body ? [n.body] : [],
    cta: { text: '点开看看', url: link },
    footer: `${user?.nickname ?? ''}，你在「算我一个」打开了邮件提醒。夜里（你那边 23 点到 8 点）不会发。`,
    unsubUrl: unsubUrl(ctx, rec.email),
  })
  ctx.mailer.enqueue(
    { to: rec.email, subject: `[${ctx.store.getSpace(ctx.store.spaceId!)!.name}] ${n.title}`, ...body, kind: n.kind, headers: { 'List-Unsubscribe': `<${unsubUrl(ctx, rec.email)}>` } },
    { recipientTz: user?.timezone ?? DEFAULT_TIMEZONE, spaceId: ctx.store.spaceId, recipientId: n.userId, objectCode: /[?&]code=([^&]+)/.exec(n.link)?.[1], interestId: n.objectId },
  )
}

/** 组局人用邮件邀请朋友（对方不需要有账号） */
export function inviteByEmail(ctx: Ctx, me: User, code: string, raw: unknown): EmailInviteResponse {
  const m = mailer(ctx)
  const input = emailInviteSchema.parse(raw)
  const event = ctx.store.getEventByCode(code)
  if (!event) throw notFound('活动不存在')
  if (event.hostId !== me.id) throw forbidden('只有组局的人能用邮件叫人')
  if (event.status !== 'open' && event.status !== 'confirmed') throw badRequest('这局现在不收人了')

  const now = ctx.now()
  const since = new Date(now.getTime() - DAY).toISOString()
  const hostEmail = ctx.store.getUserEmail(me.id)?.email ?? null
  const skipped: EmailInviteResponse['skipped'] = []
  let sent = 0
  const first = event.slots.find((s) => Date.parse(s.startUtc) > now.getTime()) ?? event.slots[0]
  const link = `${m.baseUrl}/#/pages/event/detail?code=${event.code}&space=${ctx.store.spaceId}`

  // Never disclose activity details to people outside this space or outside its invitation rules.
  const targets=input.emails.map(email=>({email,user:ctx.store.findUserEmailsByAddress(email).find(r=>r.verifiedAt&&ctx.store.isMember(r.userId))}))
  if(targets.some(t=>!t.user)) throw badRequest('只能邀请已加入本空间并验证邮箱的成员；新人请先使用空间邀请链接')
  if(targets.some(t=>event.visibility==='invited'&&t.user!.userId!==me.id&&!event.invitations.some(i=>i.userId===t.user!.userId)&&!ctx.store.getResponse(event.id,t.user!.userId))) throw badRequest('请先把该成员加入活动邀请名单')
  for (const email of [...new Set(input.emails)]) {
    const recipientId=targets.find(t=>t.email===email)!.user!.userId
    if(!ctx.store.getMembership(ctx.store.spaceId!,recipientId)?.emailEnabled) { skipped.push({email,reason:'unsubscribed'}); continue }
    if (ctx.store.isSuppressed(email)) {
      skipped.push({ email, reason: 'unsubscribed' })
      continue
    }
    if (ctx.store.countEmailInvites(me.id, since, email) > 0) {
      skipped.push({ email, reason: 'duplicate' })
      continue
    }
    if (ctx.store.countEmailToAddress(email, since) >= ADDRESS_INVITES_PER_DAY || ctx.store.countEmailInvites(me.id, since) >= HOST_INVITES_PER_DAY) {
      skipped.push({ email, reason: 'rate_limited' })
      continue
    }
    // 不知道对方在哪个时区：按默认（北京时间）写，并附上组局人的时间
    const when = first
      ? `${slotOneLine(first, DEFAULT_TIMEZONE, now)}（${zoneLabel(DEFAULT_TIMEZONE)}）${event.slots.length > 1 ? ` 等 ${event.slots.length} 个时间` : ''}`
      : ''
    const hostWhen = first && event.hostTimezone !== DEFAULT_TIMEZONE ? `组局人那边是 ${slotInOtherZone(first, DEFAULT_TIMEZONE, event.hostTimezone)}` : ''
    const games = event.options.map((o) => `${o.emoji} ${o.name}`).join(' / ')
    const body = renderEmail({
      heading: `[${ctx.store.getSpace(ctx.store.spaceId!)!.name}] ${me.nickname} 约你：${event.title}`,
      lines: [games, when, hostWhen, input.message ? `“${input.message}”` : '', '登录当前空间后即可报名，有空就来。'].filter(Boolean),
      cta: { text: '看看能不能来', url: link },
      footer: `这封邮件是 ${me.nickname} 通过「算我一个」发给你的。`,
      unsubUrl: unsubUrl(ctx, email),
    })
    m.enqueue(
      {
        to: email,
        subject: `[${ctx.store.getSpace(ctx.store.spaceId!)!.name}] ${me.nickname} 约你：${event.title}`,
        ...body,
        kind: 'email_invite',
        headers: { 'List-Unsubscribe': `<${unsubUrl(ctx, email)}>`, ...(hostEmail ? { 'Reply-To': hostEmail } : {}) },
      },
      { recipientTz: DEFAULT_TIMEZONE, spaceId: ctx.store.spaceId, recipientId, objectCode: event.code },
    )
    ctx.store.logEmailInvite(me.id, email, event.id, now.toISOString())
    sent++
  }
  return { sent, skipped, transport: m.transport.kind }
}

/** 一键退订：此后这个地址不会再收到任何邮件 */
export function unsubscribe(ctx: Ctx, token: string): string {
  const email = ctx.store.emailForUnsubToken(token)
  if (!email) throw notFound('退订链接无效')
  ctx.store.suppress(email, ctx.now().toISOString())
  for (const rec of ctx.store.findUserEmailsByAddress(email)) ctx.store.saveUserEmail({ ...rec, enabled: false })
  return email
}
