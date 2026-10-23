import { Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import type { AppNotification, NotificationsResponse } from '@couju/core'
import { Page } from '../../components/Page'
import { Card, Empty, Loading } from '../../components/ui'
import { get, post } from '../../lib/api'
import { setUnread } from '../../lib/session'
import { back, toastError } from '../../lib/ui'

const ICON: Record<AppNotification['kind'], string> = {
  friend_request: '👋',
  friend_accepted: '🤝',
  event_invite: '📮',
  event_ready: '✅',
  event_confirmed: '🎉',
  event_cancelled: '🫥',
  event_short: '🙏',
  waitlist_promoted: '🎟️',
  interest_new: '🙋',
  interest_ready: '🔥',
  join_request: '🚪',
}

function ago(iso: string): string {
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  return `${Math.floor(h / 24)} 天前`
}

/** 站内通知（已做频率限制）。微信订阅消息尚未接入。 */
export default function Notifications() {
  const [data, setData] = useState<NotificationsResponse | null>(null)

  useDidShow(() => {
    get<NotificationsResponse>('/api/notifications')
      .then((r) => {
        setData(r)
        if (r.unread > 0) {
          void post('/api/notifications/read')
          setUnread(0)
        }
      })
      .catch(toastError)
  })

  return (
    <Page>
      <View className='row row--between'>
        <View className='h1'>通知</View>
        <Text className='link' onClick={() => back()}>
          返回
        </Text>
      </View>
      <View className='muted mt4'>同类提醒会合并、限频，不会刷屏。我们也讨厌被催。</View>
      <View className='mt16'>
        {!data && <Loading />}
        {data && data.items.length === 0 && <Empty icon='🔕' text='安安静静，没有新消息' />}
        {data?.items.map((n) => (
          <Card key={n.id} onClick={() => n.link && void Taro.navigateTo({ url: n.link }).catch(() => Taro.redirectTo({ url: n.link }))}>
            <View className='row row--top gap12'>
              <Text className='emoji-md'>{ICON[n.kind]}</Text>
              <View className='flex1'>
                <View className='row row--between'>
                  <Text className={n.readAt ? 'bold' : 'bold brand-text'}>{n.title}</Text>
                </View>
                {n.body && <View className='sub mt4'>{n.body}</View>}
                <View className='muted mt4'>{ago(n.createdAt)}</View>
              </View>
            </View>
          </Card>
        ))}
      </View>
    </Page>
  )
}
