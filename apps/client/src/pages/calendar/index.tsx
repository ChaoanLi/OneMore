import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { zoneLabel, type CalendarFeedResponse, type CalendarItem, type CalendarResponse } from '@couju/core'
import { Page } from '../../components/Page'
import { FAINT, Icon } from '../../components/Icon'
import { Button, Card, Empty, Loading, SectionTitle, Sheet, Tag, cx } from '../../components/ui'
import { del, get, post } from '../../lib/api'
import { bootSession, getSession, requireUser, useSession } from '../../lib/session'
import { confirm, copyText, eventPath, go, isH5, toastError } from '../../lib/ui'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

/** 纯日历日期运算（不涉及时区：日期已由服务端按用户时区算好） */
function monthGrid(month: string): (string | null)[] {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const firstWeekday = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // 周一 = 0
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells: (string | null)[] = Array.from({ length: firstWeekday }, () => null)
  for (let d = 1; d <= days; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  return cells
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number) as [number, number]
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function dayTitle(date: string): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
  return `${m}/${d} 周${WEEK[wd]}`
}

const needsReply = (i: CalendarItem) => i.kind === 'candidate' && i.myAvailability === null

export default function CalendarPage() {
  const { user } = useSession()
  const [data, setData] = useState<CalendarResponse | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = async (month?: string) => {
    await bootSession()
    if (!getSession().user) return
    try {
      const r = await get<CalendarResponse>(`/api/calendar${month ? `?month=${month}` : ''}`)
      setData(r)
      setSelected((s) => {
        if (s && s.startsWith(r.month)) return s
        // 默认选中：今天（有局时）→ 接下来最近一个有局的日子 → 今天/月初
        const upcoming = r.items.find((x) => x.localDate >= r.today)?.localDate
        if (r.today.startsWith(r.month)) return r.items.some((x) => x.localDate === r.today) ? r.today : (upcoming ?? r.today)
        return r.items[0]?.localDate ?? `${r.month}-01`
      })
    } catch (e) {
      toastError(e)
    }
  }
  useDidShow(() => {
    void load(data?.month)
  })

  if (!user) {
    return (
      <Page nav='calendar'>
        <View className='h1 mt8'>日历</View>
        <Card className='mt16'>
          <Empty icon='🗓️' text='先让朋友知道你是谁，这里就会出现你的局'>
            <Button kind='primary' className='mt12' onClick={() => void requireUser().then(() => load())}>
              起个名字
            </Button>
          </Empty>
        </Card>
      </Page>
    )
  }
  if (!data) {
    return (
      <Page nav='calendar'>
        <Loading />
      </Page>
    )
  }

  const byDate = new Map<string, CalendarItem[]>()
  for (const it of data.items) byDate.set(it.localDate, [...(byDate.get(it.localDate) ?? []), it])
  const [y, m] = data.month.split('-')
  const dayItems = selected ? (byDate.get(selected) ?? []) : []
  const pending = data.items.filter(needsReply).length

  return (
    <Page nav='calendar'>
      <View className='row row--between mt8'>
        <View className='h1'>日历</View>
        <Text className='muted'>按{zoneLabel(data.timezone)}</Text>
      </View>
      {pending > 0 && <View className='sub mt4'>这个月有 {pending} 个时间在等你回话</View>}

      <View className='cal mt16'>
        <View className='row row--between cal__bar'>
          <View className='cal__nav' onClick={() => void load(shiftMonth(data.month, -1))}>
            <Icon name='left' />
          </View>
          <View className='col' style={{ alignItems: 'center' }}>
            <Text className='h3'>
              {y} 年 {Number(m)} 月
            </Text>
            {!data.today.startsWith(data.month) && (
              <Text className='link small' onClick={() => void load()}>
                回到今天
              </Text>
            )}
          </View>
          <View className='cal__nav' onClick={() => void load(shiftMonth(data.month, 1))}>
            <Icon name='right' />
          </View>
        </View>
        <View className='cal__grid'>
          {WEEK.map((w) => (
            <View key={w} className='cal__head'>
              {w}
            </View>
          ))}
          {monthGrid(data.month).map((date, i) => {
            if (!date) return <View key={`e${i}`} className='cal__cell' />
            const items = byDate.get(date) ?? []
            const confirmed = items.some((x) => x.kind === 'confirmed')
            const waiting = items.some(needsReply)
            const answered = items.some((x) => x.kind === 'candidate' && x.myAvailability !== null) || items.some((x) => x.kind === 'waitlist')
            const past = date < data.today
            return (
              <View key={date} className='cal__cell' onClick={() => setSelected(date)}>
                <View className={cx('cal__day', date === data.today && 'cal__day--today', date === selected && 'cal__day--on', past && 'cal__day--past')}>
                  {Number(date.slice(8))}
                </View>
                <View className='cal__dots'>
                  {confirmed && <View className='cal__dot cal__dot--ok' />}
                  {waiting && <View className='cal__dot cal__dot--wait' />}
                  {!confirmed && !waiting && answered && <View className='cal__dot cal__dot--soft' />}
                </View>
              </View>
            )
          })}
        </View>
        <View className='row gap12 cal__legend'>
          <View className='row gap4'>
            <View className='cal__dot cal__dot--ok' />
            <Text className='muted'>成了</Text>
          </View>
          <View className='row gap4'>
            <View className='cal__dot cal__dot--wait' />
            <Text className='muted'>等你回话</Text>
          </View>
          <View className='row gap4'>
            <View className='cal__dot cal__dot--soft' />
            <Text className='muted'>已回话 / 候补</Text>
          </View>
        </View>
      </View>

      {selected && (
        <>
          <SectionTitle title={dayTitle(selected)} extra={dayItems.length ? <Text className='sub small'>{dayItems.length} 个</Text> : undefined} />
          {dayItems.length === 0 ? (
            <View className='empty'>
              这天没局。
              {selected >= data.today && (
                <Text className='link' onClick={() => go('/pages/event/create')}>
                  要不要组一个？
                </Text>
              )}
            </View>
          ) : (
            dayItems.map((it) => (
              <View key={`${it.code}-${it.slotId}`} className='episode' onClick={() => go(eventPath(it.code))}>
                <View className='row wrap gap8'>
                  {it.kind === 'confirmed' && <Tag tone='ok'>成了</Tag>}
                  {it.kind === 'waitlist' && <Tag>候补中</Tag>}
                  {needsReply(it) && <Tag tone='warn'>等你回话</Tag>}
                  {it.kind === 'candidate' && it.myAvailability && (
                    <Tag>{it.myAvailability === 'yes' ? '你说可以' : it.myAvailability === 'maybe' ? '你说看情况' : '你说不行'}</Tag>
                  )}
                  {it.kind === 'candidate' && <Text className='muted'>候选时间</Text>}
                  {it.isHost && <Text className='muted'>我组的</Text>}
                </View>
                <View className='episode__title'>
                  {it.emoji} {it.title}
                </View>
                <View className='episode__line'>{it.timeLabel}</View>
              </View>
            ))
          )}
        </>
      )}

      <FeedCard />
    </Page>
  )
}

/** 订阅到手机日历（ICS） */
function FeedCard() {
  const [status, setStatus] = useState<CalendarFeedResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [help, setHelp] = useState(false)
  const [open, setOpen] = useState(false)

  useDidShow(() => {
    get<CalendarFeedResponse>('/api/me/calendar-feed')
      .then(setStatus)
      .catch(() => undefined)
  })

  const origin = isH5 && typeof window !== 'undefined' ? window.location.origin : (process.env.TARO_APP_API_BASE ?? '')
  const url = status?.path ? `${origin}${status.path}` : ''
  const localOnly = /\/\/(localhost|127\.|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(origin)

  const rotate = async () => {
    if (status?.enabled && !status.path && !(await confirm('重新生成链接？', '旧的订阅链接会失效，需要在日历里重新订阅。', '重新生成'))) return
    setBusy(true)
    try {
      setStatus(await post<CalendarFeedResponse>('/api/me/calendar-feed'))
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <View className='list-row mt24' onClick={() => setOpen(true)}>
        <Icon name='calendar' />
        <Text className='flex1'>订阅到手机日历</Text>
        {status?.enabled && <Text className='sub'>开着</Text>}
        <Icon name='right' size='sm' color={FAINT} />
      </View>
      <Sheet open={open} onClose={() => setOpen(false)} title='订阅到手机日历'>
        <View className='sub mt8'>成了的局会自动出现在手机日历里，改时间、取消也会同步。</View>

        {url ? (
          <>
            <View className='share-text mt12'>{url}</View>
            <View className='muted mt4'>只显示这一次，别发到群里。</View>
            <View className='row wrap gap8 mt12'>
              <Button kind='primary' size='sm' onClick={() => void copyText(url, '复制好了，去日历里粘贴')}>
                复制链接
              </Button>
              {isH5 && (
                <Button kind='outline' size='sm' onClick={() => (window.location.href = url.replace(/^https?:/, 'webcal:'))}>
                  用日历打开
                </Button>
              )}
            </View>
          </>
        ) : status?.enabled ? (
          <View className='row wrap gap8 mt12'>
            <Text className='ok-text'>✓ 已开启订阅</Text>
            <Button size='sm' loading={busy} onClick={rotate}>
              重新生成链接
            </Button>
            <Button
              size='sm'
              kind='danger'
              onClick={async () => {
                if (!(await confirm('关闭订阅？', '日历里的这些局下次刷新时会消失。', '关闭'))) return
                setStatus(await del<CalendarFeedResponse>('/api/me/calendar-feed').catch(() => status))
              }}
            >
              关闭
            </Button>
          </View>
        ) : (
          <Button kind='outline' className='mt12' loading={busy} onClick={rotate}>
            生成订阅链接
          </Button>
        )}

        {localOnly && (url || status?.enabled) && (
          <View className='muted mt8'>⚠️ 现在服务跑在你自己的电脑上，手机日历在外网访问不到这个地址。部署到公网后再订阅；电脑上的日历应用可以先试。</View>
        )}

        <View className='mt12'>
          <Text className='link small' onClick={() => setHelp(!help)}>
            {help ? '收起' : '怎么加到日历里？'}
          </Text>
        </View>
        {help && (
          <View className='mt8'>
            <View className='sub'>
              <Text className='bold'>iPhone：</Text>点“用日历打开”；或 设置 → 日历 → 账户 → 添加账户 → 其他 → 添加已订阅的日历，粘贴链接。
            </View>
            <View className='sub mt4'>
              <Text className='bold'>Google 日历：</Text>电脑网页版左侧“其他日历”旁的 ＋ → 通过网址添加 → 粘贴链接（手机端会自动同步）。
            </View>
            <View className='sub mt4'>
              <Text className='bold'>Outlook：</Text>添加日历 → 从网络订阅 → 粘贴链接。
            </View>
            <View className='muted mt4'>日历应用一般每隔几小时刷新一次，改动不会秒到。</View>
          </View>
        )}
      </Sheet>
    </>
  )
}
