import { DateTime } from 'luxon'
import {
  formatSlot,
  utcToLocal,
  type CalendarItem,
  type CalendarResponse,
  type GameEvent,
  type TimeSlot,
  type User,
  type UserId,
} from '@couju/core'
import type { Ctx } from './context'
import { refreshStatus } from './events'
import { hashToken, newToken, notFound } from '../util'

/**
 * 日历：
 * 1. 月历视图（应用内）：已成团的局、候补、等我回话/已回话的候选时间。
 * 2. 订阅（ICS）：只放“确定要去”的局（名单内或组局人），取消的局标记为 CANCELLED，
 *    重新开放的局会从订阅里消失——日历应用刷新时自动同步。
 */

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

function involvement(event: GameEvent, userId: UserId): 'roster' | 'waitlist' | null {
  if (!event.final) return null
  if (event.final.rosterIds.includes(userId)) return 'roster'
  if (event.final.waitlistIds.includes(userId)) return 'waitlist'
  return null
}

export function calendarMonth(ctx: Ctx, me: User, month?: string): CalendarResponse {
  const tz = me.timezone
  const now = ctx.now()
  const m = month && MONTH_RE.test(month) ? month : utcToLocal(now.toISOString(), tz).slice(0, 7)
  const start = DateTime.fromISO(`${m}-01`, { zone: tz }).startOf('day')
  const fromMs = start.toMillis()
  const toMs = start.plus({ months: 1 }).toMillis()
  const inRange = (s: TimeSlot) => {
    const t = Date.parse(s.startUtc)
    return t >= fromMs && t < toMs
  }

  const items: CalendarItem[] = []
  for (const raw of ctx.store.listEventsForUser(me.id)) {
    const event = refreshStatus(ctx, raw)
    const isHost = event.hostId === me.id
    const emoji = event.options.map((o) => o.emoji).join('')
    const base = (slot: TimeSlot) => ({
      code: event.code,
      title: event.title,
      emoji,
      isHost,
      slotId: slot.id,
      startUtc: slot.startUtc,
      endUtc: slot.endUtc,
      localDate: utcToLocal(slot.startUtc, tz).slice(0, 10),
      timeLabel: formatSlot(slot, tz, now).timeLabel,
    })

    if ((event.status === 'confirmed' || event.status === 'completed') && event.final) {
      const slot = event.slots.find((s) => s.id === event.final!.slotId)
      const rel = involvement(event, me.id)
      if (!slot || !inRange(slot) || (!rel && !isHost)) continue
      items.push({ ...base(slot), kind: rel === 'waitlist' ? 'waitlist' : 'confirmed', myAvailability: null })
      continue
    }
    if (event.status !== 'open') continue
    const mine = ctx.store.getResponse(event.id, me.id)
    if (mine?.intent === 'declined') continue
    for (const slot of event.slots) {
      if (!inRange(slot) || Date.parse(slot.startUtc) <= now.getTime()) continue
      items.push({ ...base(slot), kind: 'candidate', myAvailability: mine?.availability[slot.id] ?? null })
    }
  }
  items.sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  return { month: m, today: utcToLocal(now.toISOString(), tz).slice(0, 10), timezone: tz, items }
}

// ---------- 订阅 ----------

export function feedStatus(ctx: Ctx, me: User) {
  return { enabled: ctx.store.hasCalendarFeed(me.id), path: null }
}

/** 生成（或重新生成）订阅链接；旧链接立即失效。令牌只存哈希，明文只返回这一次。 */
export function rotateFeed(ctx: Ctx, me: User) {
  const token = newToken()
  ctx.store.setCalendarFeed(me.id, hashToken(token), ctx.now().toISOString())
  return { enabled: true, path: `/api/calendar/feed/${token}.ics` }
}

export function disableFeed(ctx: Ctx, me: User) {
  ctx.store.deleteCalendarFeed(me.id)
  return { enabled: false, path: null }
}

const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

function icsEscape(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** RFC 5545：每行最多 75 字节，续行以空格开头；按字符切分，不会切坏 UTF-8 */
export function foldLine(line: string): string {
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of line) {
    const b = Buffer.byteLength(ch)
    const limit = out.length === 0 ? 75 : 74
    if (bytes + b > limit) {
      out.push(cur)
      cur = ''
      bytes = 0
    }
    cur += ch
    bytes += b
  }
  out.push(cur)
  return out.join('\r\n ')
}

export function buildFeed(ctx: Ctx, token: string, baseUrl: string, appName: string): string {
  const userId = ctx.store.getCalendarFeedUser(hashToken(token))
  const user = userId ? ctx.store.getUser(userId) : undefined
  if (!user) throw notFound('订阅链接无效或已重新生成')
  const now = ctx.now()
  const since = now.getTime() - 60 * 24 * 3600_000

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OneMore//Calendar//ZH',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${icsEscape(appName)}`,
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  for (const raw of ctx.store.listEventsForUser(user.id)) {
    const event = refreshStatus(ctx, raw)
    if (!event.final) continue
    const going = event.final.rosterIds.includes(user.id) || event.hostId === user.id
    if (!going) continue
    if (!['confirmed', 'completed', 'cancelled'].includes(event.status)) continue
    const slot = event.slots.find((s) => s.id === event.final!.slotId)
    if (!slot || Date.parse(slot.startUtc) < since) continue
    const option = event.options.find((o) => o.id === event.final!.optionId)
    const byId = new Map(ctx.store.getUsers(event.final.rosterIds).map((u) => [u.id, u.nickname]))
    const names = event.final.rosterIds.map((id) => byId.get(id)).filter((n): n is string => !!n)
    const end = slot.endUtc ?? new Date(Date.parse(slot.startUtc) + 2 * 3600_000).toISOString()
    const link = `${baseUrl}/#/pages/event/detail?code=${event.code}&space=${ctx.store.spaceId}`
    const desc = [option ? `${option.emoji} ${option.name}` : '', names.length ? `名单：${names.join('、')}` : '', event.note, link]
      .filter(Boolean)
      .join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@onemore`,
      `DTSTAMP:${icsDate(now.toISOString())}`,
      `LAST-MODIFIED:${icsDate(event.updatedAt)}`,
      `SEQUENCE:${Math.floor(Date.parse(event.updatedAt) / 1000)}`,
      `DTSTART:${icsDate(slot.startUtc)}`,
      `DTEND:${icsDate(end)}`,
      `SUMMARY:${icsEscape(`${option?.emoji ?? ''} ${event.title}`.trim())}`,
      `DESCRIPTION:${icsEscape(desc)}`,
      `URL:${link}`,
      ...(event.location ? [`LOCATION:${icsEscape(event.location)}`] : []),
      `STATUS:${event.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(foldLine).join('\r\n') + '\r\n'
}
