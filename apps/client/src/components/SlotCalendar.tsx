import { t, useLocale } from '../lib/i18n'
import { Text, View } from '@tarojs/components'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { cx } from './ui'

/**
 * 候选时间的日历视图：只显示覆盖候选时间的那几周。
 * - 有候选时间的日子按 badge.level（0~1）深浅上色；mark = 小红点（例如“人齐”）；label = 格子里的小字。
 * - 点某一天，下方用 renderDay 显示这一天的时段。
 * 日期用服务端按查看者时区算好的 localDate（YYYY-MM-DD），这里只做纯日期运算。
 */

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const DAY_MS = 86400000

const toUtc = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number]
  return Date.UTC(y, m - 1, day)
}
const fromUtc = (t: number) => new Date(t).toISOString().slice(0, 10)
const weekdayIdx = (t: number) => (new Date(t).getUTCDay() + 6) % 7 // 周一 = 0

export interface DayBadge {
  level: number
  label?: string
  mark?: boolean
}

export function SlotCalendar<T extends { id: string; localDate: string }>(props: {
  slots: T[]
  badge: (daySlots: T[]) => DayBadge
  renderDay: (daySlots: T[], date: string) => ReactNode
  /** 默认选中的日期；不传则选第一个有时段的日子 */
  initialDate?: string
}) {
  useLocale()
  const byDate = useMemo(() => {
    const m = new Map<string, T[]>()
    for (const s of props.slots) m.set(s.localDate, [...(m.get(s.localDate) ?? []), s])
    return m
  }, [props.slots])
  const dates = [...byDate.keys()].sort()
  const [selected, setSelected] = useState<string | null>(props.initialDate ?? dates[0] ?? null)
  useEffect(() => {
    if (!selected || !byDate.has(selected)) setSelected(props.initialDate ?? dates[0] ?? null)
  }, [props.slots])

  if (dates.length === 0) return null
  const start = toUtc(dates[0]!) - weekdayIdx(toUtc(dates[0]!)) * DAY_MS
  const lastT = toUtc(dates[dates.length - 1]!)
  const end = lastT + (6 - weekdayIdx(lastT)) * DAY_MS

  const rows: { month: string | null; days: string[] }[] = []
  let prevMonth = ''
  for (let t = start; t <= end; t += 7 * DAY_MS) {
    const days = Array.from({ length: 7 }, (_, i) => fromUtc(t + i * DAY_MS))
    const firstSlotDay = days.find((d) => byDate.has(d)) ?? days[0]!
    const month = firstSlotDay.slice(0, 7)
    rows.push({ month: month !== prevMonth ? month : null, days })
    prevMonth = month
  }

  return (
    <View>
      <View className='scal'>
        <View className='scal__row'>
          {WEEK.map((w) => (
            <View key={w} className='scal__head'>
              {t(w)}
            </View>
          ))}
        </View>
        {rows.map((r) => (
          <View key={r.days[0]}>
            {r.month && <View className='scal__month'>{t('{0} 月', Number(r.month.slice(5)))}</View>}
            <View className='scal__row'>
              {r.days.map((d) => {
                const daySlots = byDate.get(d)
                if (!daySlots) {
                  return (
                    <View key={d} className='scal__cell'>
                      <View className='scal__day scal__day--empty'>{Number(d.slice(8))}</View>
                    </View>
                  )
                }
                const b = props.badge(daySlots)
                const level = Math.max(0, Math.min(1, b.level))
                const dark = level > 0.55
                return (
                  <View key={d} className='scal__cell' onClick={() => setSelected(d)}>
                    <View
                      className={cx('scal__day', 'scal__day--has', d === selected && 'scal__day--on')}
                      style={
                        level > 0
                          ? {
                              background: `rgba(20,20,20,${0.1 + level * 0.85})`,
                              color: dark ? '#fff' : '#141414',
                              borderColor: 'transparent',
                            }
                          : undefined
                      }
                    >
                      {Number(d.slice(8))}
                      {b.mark && <View className='scal__mark' />}
                    </View>
                    <Text className='scal__label'>{b.label ?? ''}</Text>
                  </View>
                )
              })}
            </View>
          </View>
        ))}
      </View>
      {selected && byDate.get(selected) && <View className='mt12'>{props.renderDay(byDate.get(selected)!, selected)}</View>}
    </View>
  )
}
