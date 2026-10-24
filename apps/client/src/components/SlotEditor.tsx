import { t, useLocale, getLocale } from '../lib/i18n'
import { Picker, Text, View } from '@tarojs/components'
import { useState } from 'react'
import {
  addMinutes,
  formatSlot,
  localToUtc,
  MAX_SLOTS,
  RECURRING_PRESETS,
  recurringSlots,
  slotInOtherZone,
  utcToLocal,
  WEEKDAY_NAMES,
  type SlotInput,
} from '@couju/core'
import { toast } from '../lib/ui'
import { FAINT, Icon } from './Icon'
import { Button, Chip, Sheet, cx } from './ui'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']
const DURATIONS = [
  { label: '1小时', min: 60 },
  { label: '2小时', min: 120 },
  { label: '3小时', min: 180 },
  { label: '4小时', min: 240 },
  { label: '不定', min: 0 },
]
const TIMES = [
  { label: '下午 2 点', value: '14:00' },
  { label: '晚上 8 点', value: '20:00' },
]

/** 纯日历日期运算（日期已按用户时区换算成 YYYY-MM-DD） */
function monthCells(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: first }, () => null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  return cells
}
function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

/**
 * 选候选时间：在日历上点一天就加上，再点一下就去掉。
 * 新加的时间用下面设好的“几点 / 玩多久”；已选列表里可以单独改某一场的时间。
 * 按用户时区输入，存为 UTC；列表里小字对照朋友所在时区。
 */
export function SlotEditor(props: {
  tz: string
  durationMin: number
  value: SlotInput[]
  onChange: (v: SlotInput[]) => void
  compareZones?: string[]
}) {
  useLocale()
  const { tz, value, onChange } = props
  const today = utcToLocal(new Date().toISOString(), tz).slice(0, 10)
  const [month, setMonth] = useState(today.slice(0, 7))
  const [time, setTime] = useState('20:00')
  const [duration, setDuration] = useState(props.durationMin)
  const [weeklyOpen, setWeeklyOpen] = useState(false)
  const [weeks, setWeeks] = useState(4)
  const [weekdays, setWeekdays] = useState<number[]>([6, 7])

  const localDate = (s: SlotInput) => utcToLocal(s.startUtc, tz).slice(0, 10)
  const sorted = [...value].sort((a, b) => a.startUtc.localeCompare(b.startUtc))
  const countByDate = new Map<string, number>()
  for (const s of value) countByDate.set(localDate(s), (countByDate.get(localDate(s)) ?? 0) + 1)
  const zone = (props.compareZones ?? []).find((z) => z !== tz)
  const maxMonth = shiftMonth(today.slice(0, 7), 3)

  const make = (date: string, hhmm: string): SlotInput => {
    const startUtc = localToUtc(`${date}T${hhmm}`, tz)
    return { startUtc, endUtc: duration > 0 ? addMinutes(startUtc, duration) : null }
  }

  const addMany = (slots: SlotInput[]) => {
    const fresh = slots.filter((x) => !value.some((s) => s.startUtc === x.startUtc))
    if (fresh.length === 0) return toast(t('已经选过了'))
    const room = MAX_SLOTS - value.length
    if (room <= 0) return toast(t('最多 {0} 个时间', MAX_SLOTS))
    onChange([...value, ...fresh.slice(0, room)])
  }

  /** 点一天：没选就加上，选了就去掉这天 */
  const tapDay = (date: string) => {
    if (countByDate.has(date)) {
      onChange(value.filter((s) => localDate(s) !== date))
      return
    }
    const slot = make(date, time)
    if (Date.parse(slot.startUtc) <= Date.now()) return toast(t('今天 {0} 已经过了，换个时间', time))
    addMany([slot])
  }

  /** 单独改某一场的开始时间（保持时长） */
  const retime = (s: SlotInput, hhmm: string) => {
    const date = localDate(s)
    const startUtc = localToUtc(`${date}T${hhmm}`, tz)
    if (Date.parse(startUtc) <= Date.now()) return toast(t('这个时间已经过了'))
    if (value.some((x) => x !== s && x.startUtc === startUtc)) return toast(t('已经有这个时间了'))
    const dur = s.endUtc ? Date.parse(s.endUtc) - Date.parse(s.startUtc) : 0
    onChange(value.map((x) => (x === s ? { startUtc, endUtc: dur > 0 ? new Date(Date.parse(startUtc) + dur).toISOString() : null } : x)))
  }

  const weekly = recurringSlots({ tz, now: new Date(), weeks, weekdays, time, durationMin: duration })
  // 当月只从本周开始显示（过去的几周点不了，不占地方）
  const visibleCells = (() => {
    const cells = monthCells(month)
    if (month !== today.slice(0, 7)) return cells
    const weeksArr: (string | null)[][] = []
    for (let i = 0; i < cells.length; i += 7) weeksArr.push(cells.slice(i, i + 7))
    return weeksArr.filter((w) => w.some((d) => d !== null && d >= today)).flat()
  })()

  return (
    <View>
      <View className='pick-cal'>
        <View className='row row--between cal__bar'>
          <View
            className={cx('cal__nav', month <= today.slice(0, 7) && 'cal__nav--off')}
            onClick={() => month > today.slice(0, 7) && setMonth(shiftMonth(month, -1))}
          >
            <Icon name='left' />
          </View>
          <Text className='h3'>{t('{0} 年 {1}月', month.slice(0, 4), Number(month.slice(5)))}</Text>
          <View
            className={cx('cal__nav', month >= maxMonth && 'cal__nav--off')}
            onClick={() => month < maxMonth && setMonth(shiftMonth(month, 1))}
          >
            <Icon name='right' />
          </View>
        </View>
        <View className='scal__row'>
          {WEEK.map((w) => (
            <View key={w} className='scal__head'>
              {t(w)}
            </View>
          ))}
        </View>
        <View className='scal__row wrap'>
          {visibleCells.map((d, i) => {
            if (!d) return <View key={`e${i}`} className='scal__cell' />
            const past = d < today
            const n = countByDate.get(d) ?? 0
            return (
              <View key={d} className='scal__cell' onClick={() => !past && tapDay(d)}>
                <View
                  className={cx(
                    'scal__day',
                    past ? 'scal__day--empty' : n > 0 ? 'scal__day--picked' : 'scal__day--free',
                    d === today && 'scal__day--today',
                  )}
                >
                  {Number(d.slice(8))}
                </View>
                <Text className='scal__label'>{n > 1 ? t('{0}场', n) : ''}</Text>
              </View>
            )
          })}
        </View>
      </View>

      {/* 新加的时间用这个 */}
      <View className='row wrap gap8 mt12'>
        {TIMES.map((timing) => (
          <Chip key={timing.value} small on={time === timing.value} onClick={() => setTime(timing.value)}>
            {t(timing.label)}
          </Chip>
        ))}
        <Picker mode='time' value={time} onChange={(e) => setTime(String(e.detail.value))}>
          <View className={cx('chip chip--sm', !TIMES.some((t) => t.value === time) && 'chip--on')}>
            <Icon name='clock' size='sm' />
            <Text className='ml4'>{TIMES.some((t) => t.value === time) ? t('其他') : time}</Text>
          </View>
        </Picker>
        <View className='chip chip--sm chip--dashed' onClick={() => setWeeklyOpen(true)}>
          {t('每周重复')}
        </View>
      </View>

      {sorted.length > 0 && (
        <View className='mt12'>
          {sorted.map((s) => {
            const d = formatSlot(s, tz, undefined, getLocale())
            const hhmm = utcToLocal(s.startUtc, tz).slice(11, 16)
            return (
              <View key={s.startUtc} className='slot row'>
                <View className='flex1'>
                  <View className='row gap8'>
                    <Text className='bold'>{[d.relativeLabel, d.dateLabel].filter(Boolean).join(' ')}</Text>
                    <Picker mode='time' value={hhmm} onChange={(e) => retime(s, String(e.detail.value))}>
                      <Text className='time-pill'>{d.timeLabel}</Text>
                    </Picker>
                  </View>
                  {zone && <View className='muted'>{slotInOtherZone(s, tz, zone, getLocale())}</View>}
                </View>
                <Icon name='x' size='sm' color={FAINT} onClick={() => onChange(value.filter((x) => x !== s))} />
              </View>
            )
          })}
          {sorted.length > 3 && (
            <View className='right-link'>
              <Text className='link small' onClick={() => onChange([])}>
                {t('清空')}
              </Text>
            </View>
          )}
        </View>
      )}

      <Sheet open={weeklyOpen} onClose={() => setWeeklyOpen(false)} title={t('每周重复')}>
        <View className='row wrap gap8 mt12'>
          {RECURRING_PRESETS.map((p) => (
            <Chip
              key={p.key}
              small
              onClick={() => {
                addMany(recurringSlots({ tz, now: new Date(), weeks: p.weeks, weekdays: p.weekdays, time: p.time, durationMin: duration }))
                setWeeklyOpen(false)
              }}
            >
              {t(p.label)}
            </Chip>
          ))}
        </View>
        <View className='divider' />
        <View className='row wrap gap8'>
          {[2, 4, 8].map((w) => (
            <Chip key={w} small on={weeks === w} onClick={() => setWeeks(w)}>
              {w === 4 ? t('一个月') : w === 8 ? t('两个月') : t('两周')}
            </Chip>
          ))}
        </View>
        <View className='row wrap gap8 mt8'>
          {WEEKDAY_NAMES.map((name, i) => {
            const wd = i + 1
            const on = weekdays.includes(wd)
            return (
              <Chip key={name} small on={on} onClick={() => setWeekdays(on ? weekdays.filter((x) => x !== wd) : [...weekdays, wd].sort())}>
                {getLocale() === 'en' ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i] : name.replace('周', '')}
              </Chip>
            )
          })}
        </View>
        <View className='row wrap gap8 mt8'>
          <Picker mode='time' value={time} onChange={(e) => setTime(String(e.detail.value))}>
            <View className='picker-box'>{t('每次 {0}', time)}</View>
          </Picker>
        </View>
        <View className='row wrap gap8 mt8'>
          {DURATIONS.map((d) => (
            <Chip key={d.min} small on={duration === d.min} onClick={() => setDuration(d.min)}>
              {t(d.label)}
            </Chip>
          ))}
        </View>
        <Button
          kind='primary'
          block
          className='mt16'
          disabled={weekly.length === 0}
          onClick={() => {
            addMany(weekly)
            setWeeklyOpen(false)
          }}
        >
          {t('加上{0}个', weekly.length)}
        </Button>
      </Sheet>
    </View>
  )
}
