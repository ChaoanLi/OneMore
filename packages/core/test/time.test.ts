import { describe, expect, it } from 'vitest'
import {
  dayShift,
  formatSlot,
  isValidTimeZone,
  localToUtc,
  quickPresets,
  recurringSlots,
  MAX_SLOTS,
  resolveWhen,
  slotInOtherZone,
  suggestSlots,
  utcToLocal,
} from '../src/time'

const CHI = 'America/Chicago'
const SH = 'Asia/Shanghai'
// 2026-10-23 周五 10:00 CDT
const NOW = new Date('2026-10-23T15:00:00Z')

describe('时区转换', () => {
  it('校验 IANA 时区', () => {
    expect(isValidTimeZone(CHI)).toBe(true)
    expect(isValidTimeZone('Asia/Shanghai')).toBe(true)
    expect(isValidTimeZone('Mars/Base')).toBe(false)
    expect(isValidTimeZone('')).toBe(false)
  })

  it('夏令时期间：美中周六 20:00 = 北京周日 09:00（跨日 +1）', () => {
    const utc = localToUtc('2026-10-31T20:00', CHI)
    expect(utc).toBe('2026-11-01T01:00:00.000Z')
    expect(utcToLocal(utc, SH)).toBe('2026-11-01T09:00')
    expect(dayShift(utc, CHI, SH)).toBe(1)
    expect(dayShift(utc, SH, CHI)).toBe(-1)
  })

  it('美国 2026-11-01 结束夏令时后，同样的本地时间对应的北京时间晚一小时', () => {
    const utc = localToUtc('2026-11-07T20:00', CHI)
    expect(utc).toBe('2026-11-08T02:00:00.000Z')
    expect(utcToLocal(utc, SH)).toBe('2026-11-08T10:00')
  })

  it('时区缩写随夏令时变化（CDT → CST）', () => {
    const before = formatSlot({ startUtc: '2026-10-31T19:00:00.000Z', endUtc: null }, CHI, NOW)
    const after = formatSlot({ startUtc: '2026-11-07T20:00:00.000Z', endUtc: null }, CHI, NOW)
    expect(before.zoneAbbr).toMatch(/CDT|GMT-5/)
    expect(after.zoneAbbr).toMatch(/CST|GMT-6/)
  })

  it('春季“跳过”的不存在时刻会被顺延，而不是报错', () => {
    // 2027-03-14 02:30 在美中时间不存在
    const utc = localToUtc('2027-03-14T02:30', CHI)
    expect(utcToLocal(utc, CHI)).toBe('2027-03-14T03:30')
  })

  it('秋季重复的时刻得到一个确定的结果', () => {
    const utc = localToUtc('2026-11-01T01:30', CHI)
    expect(['2026-11-01T06:30:00.000Z', '2026-11-01T07:30:00.000Z']).toContain(utc)
  })

  it('formatSlot 输出相对日期、跨日结束标记', () => {
    const d = formatSlot({ startUtc: '2026-10-24T03:00:00.000Z', endUtc: '2026-10-24T06:00:00.000Z' }, CHI, NOW)
    // 美中 10/23 22:00 – 10/24 01:00
    expect(d.relativeLabel).toBe('今天')
    expect(d.dateLabel).toBe('10/23 周五')
    expect(d.endsNextDay).toBe(true)
    expect(d.timeLabel).toBe('22:00–01:00(次日)')
  })

  it('slotInOtherZone 标出跨日', () => {
    const s = slotInOtherZone({ startUtc: '2026-11-01T01:00:00.000Z', endUtc: null }, CHI, SH)
    expect(s).toBe('北京时间 11/1 周日 09:00 (+1天)')
  })
})

describe('相对日期（确定性代码）', () => {
  it('周五说“这周末” = 周六、周日', () => {
    expect(resolveWhen('this_weekend', NOW, CHI)).toEqual({ from: '2026-10-24', to: '2026-10-25' })
  })
  it('周日说“这周末” = 今天', () => {
    const sunday = new Date('2026-10-25T15:00:00Z')
    expect(resolveWhen('this_weekend', sunday, CHI)).toEqual({ from: '2026-10-25', to: '2026-10-25' })
  })
  it('下周末、下周', () => {
    expect(resolveWhen('next_weekend', NOW, CHI)).toEqual({ from: '2026-10-31', to: '2026-11-01' })
    expect(resolveWhen('next_week', NOW, CHI)).toEqual({ from: '2026-10-26', to: '2026-11-01' })
  })
  it('“今晚”按用户自己的时区解释：同一时刻北京已经是周六', () => {
    const late = new Date('2026-10-23T17:00:00Z') // 美中周五 12:00，北京周六 01:00
    expect(resolveWhen('tonight', late, CHI).from).toBe('2026-10-23')
    expect(resolveWhen('tonight', late, SH).from).toBe('2026-10-24')
  })
})

describe('候选时段生成', () => {
  it('周末未指定时段 → 下午 + 晚上，最多 4 个，跳过过去时间', () => {
    const slots = suggestSlots({
      range: { from: '2026-10-24', to: '2026-10-25' },
      timeOfDay: null,
      tz: CHI,
      now: NOW,
      durationMin: 120,
    })
    expect(slots.map((s) => utcToLocal(s.startUtc, CHI))).toEqual([
      '2026-10-24T14:00',
      '2026-10-24T20:00',
      '2026-10-25T14:00',
      '2026-10-25T20:00',
    ])
    expect(Date.parse(slots[0]!.endUtc) - Date.parse(slots[0]!.startUtc)).toBe(120 * 60_000)
  })

  it('今晚已经过了 20:00 时不生成过去的时段', () => {
    const night = new Date('2026-10-24T02:00:00Z') // 美中 21:00
    const slots = suggestSlots({ range: { from: '2026-10-23', to: '2026-10-23' }, timeOfDay: 'evening', tz: CHI, now: night, durationMin: 60 })
    expect(slots).toEqual([])
  })

  it('快捷时段都在未来且不重复', () => {
    const presets = quickPresets(NOW, CHI, 120)
    expect(presets.length).toBeGreaterThan(4)
    const starts = presets.map((p) => p.startUtc)
    expect(new Set(starts).size).toBe(starts.length)
    for (const p of presets) expect(Date.parse(p.startUtc)).toBeGreaterThan(NOW.getTime())
    // 今天周五：“明晚”就是周六晚，去重后只保留一个
    expect(presets.map((p) => p.label)).toEqual(['今晚 20:00', '明晚 20:00', '周六下午 10/24', '周日下午 10/25', '周日晚 10/25'])
  })
})

describe('提前排好几周（批量时段）', () => {
  it('北京时间：未来 4 个周末晚上 = 8 个时段，从明天（周六）开始', () => {
    const slots = recurringSlots({ tz: SH, now: NOW, weeks: 4, weekdays: [6, 7], time: '20:00', durationMin: 120 })
    expect(slots.map((s) => utcToLocal(s.startUtc, SH))).toEqual([
      '2026-10-24T20:00', '2026-10-25T20:00', '2026-10-31T20:00', '2026-11-01T20:00',
      '2026-11-07T20:00', '2026-11-08T20:00', '2026-11-14T20:00', '2026-11-15T20:00',
    ])
  })

  it('美中时间跨过 11/1 夏令时结束：本地始终是 20:00，对应的 UTC 晚一小时', () => {
    const slots = recurringSlots({ tz: CHI, now: NOW, weeks: 3, weekdays: [6], time: '20:00', durationMin: 0 })
    expect(slots.map((s) => utcToLocal(s.startUtc, CHI))).toEqual(['2026-10-24T20:00', '2026-10-31T20:00', '2026-11-07T20:00'])
    expect(slots.map((s) => s.startUtc)).toEqual(['2026-10-25T01:00:00.000Z', '2026-11-01T01:00:00.000Z', '2026-11-08T02:00:00.000Z'])
    expect(slots[0]!.endUtc).toBeNull()
  })

  it('跳过已经过去的时刻，并受上限约束', () => {
    const lateFri = new Date('2026-10-23T13:00:00Z') // 北京 21:00 周五
    const fri = recurringSlots({ tz: SH, now: lateFri, weeks: 1, weekdays: [5], time: '20:00', durationMin: 60 })
    expect(fri).toEqual([])
    const many = recurringSlots({ tz: SH, now: NOW, weeks: 8, weekdays: [1, 2, 3, 4, 5, 6, 7], time: '20:00', durationMin: 60 })
    expect(many).toHaveLength(MAX_SLOTS)
  })
})

describe('邮件免打扰', () => {
  it('北京白天立即发；北京 23:30 顺延到次日 08:30；凌晨 3 点顺延到当天 08:30', async () => {
    const { quietHoursSendAt } = await import('../src/time')
    const day = new Date('2026-10-23T06:00:00Z') // 北京 14:00
    expect(quietHoursSendAt(day, SH)).toBe(day)
    expect(quietHoursSendAt(new Date('2026-10-23T15:30:00Z'), SH).toISOString()).toBe('2026-10-24T00:30:00.000Z') // 北京 23:30 → 次日 08:30
    expect(quietHoursSendAt(new Date('2026-10-23T19:00:00Z'), SH).toISOString()).toBe('2026-10-24T00:30:00.000Z') // 北京 03:00 → 当天 08:30
  })
  it('同一时刻，对美中的人是白天就立即发', async () => {
    const { quietHoursSendAt } = await import('../src/time')
    const t = new Date('2026-10-23T15:30:00Z') // 北京 23:30 = 美中 10:30
    expect(quietHoursSendAt(t, CHI)).toBe(t)
  })
})
