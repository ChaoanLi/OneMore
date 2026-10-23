import { DateTime, IANAZone } from 'luxon'
import type { TimeSlot } from './types'

/**
 * 时区工具。原则：
 * - 存储一律 UTC；输入与展示一律带 IANA 时区。
 * - 夏令时由 Luxon（基于 Intl 时区数据）处理；不手写偏移量。
 * - 跨日用“本地日历日期差”表示（+1 天 / -1 天）。
 */

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const

const ZONE_NAMES: Record<string, string> = {
  'Asia/Shanghai': '北京时间',
  'Asia/Chongqing': '北京时间',
  'Asia/Hong_Kong': '香港时间',
  'Asia/Taipei': '台北时间',
  'Asia/Tokyo': '东京时间',
  'America/New_York': '美东时间',
  'America/Chicago': '美中时间',
  'America/Denver': '山地时间',
  'America/Phoenix': '凤凰城时间',
  'America/Los_Angeles': '美西时间',
  'Europe/London': '伦敦时间',
  'Europe/Berlin': '柏林时间',
  'Australia/Sydney': '悉尼时间',
}

/** 默认时区：北京时间（大部分朋友在国内）。用户可以在“我”里改成自己的时区。 */
export const DEFAULT_TIMEZONE = 'Asia/Shanghai'

export const COMMON_TIMEZONES = Object.keys(ZONE_NAMES).filter((z) => z !== 'Asia/Chongqing')

export function isValidTimeZone(tz: string): boolean {
  return typeof tz === 'string' && tz.length > 0 && IANAZone.isValidZone(tz)
}

export function zoneLabel(tz: string): string {
  if (ZONE_NAMES[tz]) return ZONE_NAMES[tz]
  const city = tz.split('/').pop() ?? tz
  return `${city.replace(/_/g, ' ')}时间`
}

/** 本地时间（"YYYY-MM-DDTHH:mm"）+ IANA 时区 → UTC ISO。夏令时“跳过”的时刻会被顺延。 */
export function localToUtc(local: string, tz: string): string {
  const dt = DateTime.fromISO(local, { zone: tz })
  if (!dt.isValid) throw new Error(`无效的本地时间: ${local} @ ${tz}`)
  return dt.toUTC().toISO({ suppressMilliseconds: false })!
}

/** UTC ISO → 指定时区下的本地 "YYYY-MM-DDTHH:mm" */
export function utcToLocal(utc: string, tz: string): string {
  return DateTime.fromISO(utc, { zone: 'utc' }).setZone(tz).toFormat("yyyy-MM-dd'T'HH:mm")
}

/** 两个时区看同一时刻时的日历日期差，例如 美中 周六 20:00 = 北京 周日 09:00 → +1 */
export function dayShift(utc: string, fromTz: string, toTz: string): number {
  const base = DateTime.fromISO(utc, { zone: 'utc' })
  const a = base.setZone(fromTz)
  const b = base.setZone(toTz)
  const da = DateTime.fromObject({ year: a.year, month: a.month, day: a.day }, { zone: 'utc' })
  const db = DateTime.fromObject({ year: b.year, month: b.month, day: b.day }, { zone: 'utc' })
  return Math.round(db.diff(da, 'days').days)
}

export interface SlotDisplay {
  /** 例如 "10/24 周六" */
  dateLabel: string
  /** 例如 "今天"、"明天"，否则为空 */
  relativeLabel: string
  /** 例如 "20:00–22:00" 或 "20:00" */
  timeLabel: string
  /** 结束时间是否已到第二天 */
  endsNextDay: boolean
  zoneLabel: string
  /** 时区缩写，例如 CDT / CST，夏令时会变化 */
  zoneAbbr: string
  isPast: boolean
}

export function formatSlot(slot: Pick<TimeSlot, 'startUtc' | 'endUtc'>, tz: string, now: Date = new Date()): SlotDisplay {
  const start = DateTime.fromISO(slot.startUtc, { zone: 'utc' }).setZone(tz)
  const end = slot.endUtc ? DateTime.fromISO(slot.endUtc, { zone: 'utc' }).setZone(tz) : null
  const today = DateTime.fromJSDate(now).setZone(tz).startOf('day')
  const diffDays = Math.round(start.startOf('day').diff(today, 'days').days)
  const relativeLabel = diffDays === 0 ? '今天' : diffDays === 1 ? '明天' : diffDays === 2 ? '后天' : ''
  const endsNextDay = !!end && !end.hasSame(start, 'day')
  return {
    dateLabel: `${start.toFormat('M/d')} ${WEEKDAYS[start.weekday - 1]}`,
    relativeLabel,
    timeLabel: end ? `${start.toFormat('HH:mm')}–${end.toFormat('HH:mm')}${endsNextDay ? '(次日)' : ''}` : start.toFormat('HH:mm'),
    endsNextDay,
    zoneLabel: zoneLabel(tz),
    // 用英文区域取缩写（CDT/CST），中文环境下 Intl 只会给出 GMT-5
    zoneAbbr: start.setLocale('en-US').offsetNameShort ?? start.toFormat('ZZ'),
    isPast: start.toMillis() < now.getTime(),
  }
}

/** 一行文字描述，例如 "明天 10/24 周六 20:00–22:00" */
export function slotOneLine(slot: Pick<TimeSlot, 'startUtc' | 'endUtc'>, tz: string, now: Date = new Date()): string {
  const d = formatSlot(slot, tz, now)
  return [d.relativeLabel, d.dateLabel, d.timeLabel].filter(Boolean).join(' ')
}

/** 另一个时区的对照，例如 "北京时间 10/25 周日 09:00 (+1天)" */
export function slotInOtherZone(slot: Pick<TimeSlot, 'startUtc' | 'endUtc'>, viewerTz: string, otherTz: string): string {
  const start = DateTime.fromISO(slot.startUtc, { zone: 'utc' }).setZone(otherTz)
  const shift = dayShift(slot.startUtc, viewerTz, otherTz)
  const shiftLabel = shift === 0 ? '' : ` (${shift > 0 ? '+' : ''}${shift}天)`
  return `${zoneLabel(otherTz)} ${start.toFormat('M/d')} ${WEEKDAYS[start.weekday - 1]} ${start.toFormat('HH:mm')}${shiftLabel}`
}

export function addMinutes(utc: string, minutes: number): string {
  return DateTime.fromISO(utc, { zone: 'utc' }).plus({ minutes }).toUTC().toISO()!
}

// ---------- 相对日期解析（确定性代码，不交给语言模型） ----------

export type WhenKeyword =
  | 'tonight'
  | 'tomorrow'
  | 'this_weekend'
  | 'next_weekend'
  | 'this_week'
  | 'next_week'
  | 'weekdays'
  | 'next_month_weekends'

export type TimeOfDay = 'morning' | 'afternoon' | 'evening' | 'night'

export interface DateRange {
  /** YYYY-MM-DD（用户时区下的日期） */
  from: string
  to: string
}

export function resolveWhen(when: WhenKeyword, now: Date, tz: string): DateRange {
  const today = DateTime.fromJSDate(now).setZone(tz).startOf('day')
  const fmt = (d: DateTime) => d.toFormat('yyyy-MM-dd')
  const wd = today.weekday // 1=周一 … 7=周日
  switch (when) {
    case 'tonight':
      return { from: fmt(today), to: fmt(today) }
    case 'tomorrow':
      return { from: fmt(today.plus({ days: 1 })), to: fmt(today.plus({ days: 1 })) }
    case 'this_weekend': {
      if (wd === 7) return { from: fmt(today), to: fmt(today) }
      const sat = today.plus({ days: 6 - wd })
      return { from: fmt(sat), to: fmt(sat.plus({ days: 1 })) }
    }
    case 'next_weekend': {
      const thisSat = today.plus({ days: wd === 7 ? -1 : 6 - wd })
      const sat = thisSat.plus({ days: 7 })
      return { from: fmt(sat), to: fmt(sat.plus({ days: 1 })) }
    }
    case 'this_week': {
      const sun = today.plus({ days: 7 - wd })
      return { from: fmt(today), to: fmt(sun) }
    }
    case 'next_week': {
      const mon = today.plus({ days: 8 - wd })
      return { from: fmt(mon), to: fmt(mon.plus({ days: 6 })) }
    }
    case 'next_month_weekends': {
      // 接下来四周（含今天），具体只取周末由调用方过滤
      return { from: fmt(today), to: fmt(today.plus({ days: 27 })) }
    }
    case 'weekdays': {
      // 接下来 5 个工作日
      const days: DateTime[] = []
      let d = today
      while (days.length < 5) {
        if (d.weekday <= 5) days.push(d)
        d = d.plus({ days: 1 })
      }
      return { from: fmt(days[0]!), to: fmt(days[days.length - 1]!) }
    }
  }
}

const TIME_OF_DAY_START: Record<TimeOfDay, string> = {
  morning: '10:00',
  afternoon: '14:00',
  evening: '20:00',
  night: '21:30',
}

/**
 * 根据日期范围和时间偏好生成候选时段（用户时区）。
 * 规则简单可预期：每天一个时段；周末且未指定时段时给下午 + 晚上；跳过已经过去的时间；最多 maxSlots 个。
 */
export function suggestSlots(opts: {
  range: DateRange
  timeOfDay: TimeOfDay | null
  tz: string
  now: Date
  durationMin: number
  maxSlots?: number
  /** 只保留这些星期几（1=周一 … 7=周日） */
  weekdays?: number[]
}): { startUtc: string; endUtc: string }[] {
  const { range, timeOfDay, tz, now, durationMin, weekdays } = opts
  const maxSlots = opts.maxSlots ?? 4
  const out: { startUtc: string; endUtc: string }[] = []
  let day = DateTime.fromISO(range.from, { zone: tz }).startOf('day')
  const last = DateTime.fromISO(range.to, { zone: tz }).startOf('day')
  let guard = 0
  while (day <= last && out.length < maxSlots && guard++ < 31) {
    if (weekdays && !weekdays.includes(day.weekday)) {
      day = day.plus({ days: 1 })
      continue
    }
    const isWeekend = day.weekday >= 6
    const times = timeOfDay ? [TIME_OF_DAY_START[timeOfDay]] : isWeekend ? ['14:00', '20:00'] : ['20:00']
    for (const t of times) {
      const startUtc = localToUtc(`${day.toFormat('yyyy-MM-dd')}T${t}`, tz)
      if (new Date(startUtc).getTime() <= now.getTime()) continue
      if (out.length >= maxSlots) break
      out.push({ startUtc, endUtc: addMinutes(startUtc, durationMin) })
    }
    day = day.plus({ days: 1 })
  }
  return out
}

/** 一个活动最多的候选时段数（批量排几周时够用，又不至于让朋友勾到手软） */
export const MAX_SLOTS = 24

export const WEEKDAY_NAMES = WEEKDAYS

/**
 * 批量生成重复时段：接下来 weeks 周里，每个选中的星期几的同一时刻（按用户时区）。
 * 每个日期单独换算 UTC，所以跨夏令时切换也保持“本地 20:00”。已经过去的时刻跳过。
 */
export function recurringSlots(opts: {
  tz: string
  now: Date
  weeks: number
  weekdays: number[]
  time: string
  durationMin: number
  max?: number
}): { startUtc: string; endUtc: string | null }[] {
  const { tz, now, weeks, weekdays, time, durationMin } = opts
  const max = opts.max ?? MAX_SLOTS
  const out: { startUtc: string; endUtc: string | null }[] = []
  const today = DateTime.fromJSDate(now).setZone(tz).startOf('day')
  for (let i = 0; i < weeks * 7 && out.length < max; i++) {
    const day = today.plus({ days: i })
    if (!weekdays.includes(day.weekday)) continue
    const startUtc = localToUtc(`${day.toFormat('yyyy-MM-dd')}T${time}`, tz)
    if (Date.parse(startUtc) <= now.getTime()) continue
    out.push({ startUtc, endUtc: durationMin > 0 ? addMinutes(startUtc, durationMin) : null })
  }
  return out
}

export interface RecurringPreset {
  key: string
  label: string
  weeks: number
  weekdays: number[]
  time: string
}

/** 常用的“提前排好”组合 */
export const RECURRING_PRESETS: RecurringPreset[] = [
  { key: 'weekend-eve-4', label: '未来 4 个周末晚上', weeks: 4, weekdays: [6, 7], time: '20:00' },
  { key: 'sat-aft-4', label: '未来 4 个周六下午', weeks: 4, weekdays: [6], time: '14:00' },
  { key: 'fri-eve-4', label: '未来 4 个周五晚上', weeks: 4, weekdays: [5], time: '20:00' },
  { key: 'weekday-eve-2', label: '接下来两周工作日晚上', weeks: 2, weekdays: [1, 2, 3, 4, 5], time: '20:30' },
]

export interface QuickPreset {
  key: string
  label: string
  startUtc: string
  endUtc: string
}

/** 创建活动时的快捷时段：今晚、明晚、周五晚、周六下午/晚上、周日下午/晚上（取最近一次）。 */
export function quickPresets(now: Date, tz: string, durationMin: number): QuickPreset[] {
  const today = DateTime.fromJSDate(now).setZone(tz).startOf('day')
  const candidates: { key: string; label: string; day: DateTime; time: string }[] = []
  candidates.push({ key: 'tonight', label: '今晚 20:00', day: today, time: '20:00' })
  candidates.push({ key: 'tomorrow', label: '明晚 20:00', day: today.plus({ days: 1 }), time: '20:00' })
  const next = (weekday: number) => {
    const delta = (weekday - today.weekday + 7) % 7
    return today.plus({ days: delta })
  }
  candidates.push({ key: 'fri-eve', label: '周五晚', day: next(5), time: '20:00' })
  candidates.push({ key: 'sat-aft', label: '周六下午', day: next(6), time: '14:00' })
  candidates.push({ key: 'sat-eve', label: '周六晚', day: next(6), time: '20:00' })
  candidates.push({ key: 'sun-aft', label: '周日下午', day: next(7), time: '14:00' })
  candidates.push({ key: 'sun-eve', label: '周日晚', day: next(7), time: '20:00' })

  const seen = new Set<string>()
  const out: QuickPreset[] = []
  for (const c of candidates) {
    let startUtc = localToUtc(`${c.day.toFormat('yyyy-MM-dd')}T${c.time}`, tz)
    if (new Date(startUtc).getTime() <= now.getTime()) {
      if (c.key === 'tonight') continue
      // 本周这天已过 → 顺延一周
      startUtc = localToUtc(`${c.day.plus({ days: 7 }).toFormat('yyyy-MM-dd')}T${c.time}`, tz)
    }
    if (seen.has(startUtc)) continue
    seen.add(startUtc)
    const d = DateTime.fromISO(startUtc, { zone: 'utc' }).setZone(tz)
    const label = c.key === 'tonight' || c.key === 'tomorrow' ? c.label : `${c.label} ${d.toFormat('M/d')}`
    out.push({ key: c.key, label, startUtc, endUtc: addMinutes(startUtc, durationMin) })
  }
  return out
}

/**
 * 免打扰：收件人本地时间 23:00–08:00 之间不发，顺延到当天/次日 08:30（按收件人时区，含夏令时）。
 * 返回应发送的 UTC 时刻。
 */
export function quietHoursSendAt(now: Date, tz: string, startHour = 23, endHour = 8): Date {
  const local = DateTime.fromJSDate(now).setZone(tz)
  const h = local.hour
  if (h < startHour && h >= endHour) return now
  const day = h >= startHour ? local.plus({ days: 1 }) : local
  return day.set({ hour: endHour, minute: 30, second: 0, millisecond: 0 }).toJSDate()
}

export function compareUtc(a: string, b: string): number {
  return new Date(a).getTime() - new Date(b).getTime()
}
