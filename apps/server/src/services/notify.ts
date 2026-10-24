import { shouldNotify, type AppNotification, type NotificationKind, type UserId } from '@couju/core'
import type { Ctx } from './context'
import { newId } from '../util'
import { notificationEmail } from './email'

/**
 * 应用内通知（站内信）+ 邮件（用户验证邮箱并打开提醒时）。
 * 尚未接入：微信订阅消息、App 推送。接入时同样复用这里的频率限制。
 */
export function notify(
  ctx: Ctx,
  userId: UserId,
  n: { objectId?: string; kind: NotificationKind; title: string; body: string; link: string; dedupeKey: string },
): boolean {
  if(!ctx.store.isMember(userId)) return false
  const separator = n.link.includes('?') ? '&' : '?'
  n = { ...n, link: `${n.link}${separator}space=${ctx.store.spaceId}` }
  const now = ctx.now()
  const since = new Date(now.getTime() - 72 * 3600_000).toISOString()
  const history = ctx.store.listNotifications(userId, since)
  const decision = shouldNotify(history, n, now)
  if (!decision.send) return false
  const item: AppNotification = { id: newId('n'), userId, ...n, createdAt: now.toISOString(), readAt: null }
  ctx.store.saveNotification(item)
  // 打开了邮件提醒的人同时收到邮件（夜间顺延）
  notificationEmail(ctx, item)
  return true
}

export function listNotifications(ctx: Ctx, userId: UserId) {
  return { items: ctx.store.listNotifications(userId), unread: ctx.store.unreadCount(userId) }
}

export function markAllRead(ctx: Ctx, userId: UserId) {
  ctx.store.markAllRead(userId, ctx.now().toISOString())
}
