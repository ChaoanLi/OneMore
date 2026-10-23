import { Text, View } from '@tarojs/components'
import { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import type { EventCard, InterestView, InterestsResponse, MyEventsResponse } from '@couju/core'
import { GamesSheet, shouldOfferSetup } from '../../components/Games'
import { Icon, RED } from '../../components/Icon'
import { Logo } from '../../components/Logo'
import { Page } from '../../components/Page'
import { Avatar, Button, Card, Progress, SectionTitle, Tag } from '../../components/ui'
import { del, get, post } from '../../lib/api'
import { APP_NAME, APP_NAME_EN } from '../../lib/brand'
import { setPrefill } from '../../lib/draftStore'
import { bootSession, getSession, refreshMe, requireUser, useSession } from '../../lib/session'
import { confirm, eventPath, go, toastError } from '../../lib/ui'

export default function Index() {
  const { user, ready, unread } = useSession()
  const [events, setEvents] = useState<MyEventsResponse | null>(null)
  const [interests, setInterests] = useState<InterestsResponse | null>(null)
  const [setup, setSetup] = useState(false)

  const load = async () => {
    await bootSession()
    const me = getSession().user
    if (!me) return
    if (shouldOfferSetup(me)) setSetup(true)
    try {
      const [e, i] = await Promise.all([get<MyEventsResponse>('/api/events'), get<InterestsResponse>('/api/interests')])
      setEvents(e)
      setInterests(i)
      void refreshMe()
    } catch (err) {
      toastError(err)
    }
  }
  useDidShow(() => {
    void load()
  })

  const start = async (url: string) => {
    if (await requireUser('先让朋友知道你是谁')) go(url)
  }

  const allInterests = interests ? [...interests.mine, ...interests.friends] : []
  const updateInterest = (next: InterestView) =>
    setInterests((prev) =>
      prev
        ? {
            mine: next.joinedByMe || next.isMine ? upsert(prev.mine, next) : prev.mine.filter((x) => x.id !== next.id),
            friends: next.joinedByMe ? prev.friends.filter((x) => x.id !== next.id) : upsert(prev.friends, next),
          }
        : prev,
    )

  return (
    <Page nav='home'>
      {user && (
        <View className='row row--between'>
          <Avatar user={user} size='sm' />
          <View className='icon-btn icon-btn--bare' onClick={() => go('/pages/notifications/index')}>
            <Icon name='bell' />
            {unread > 0 && <View className='dot'>{unread}</View>}
          </View>
        </View>
      )}

      <View className='hero'>
        <Logo size={user ? 'md' : 'lg'} />
        <View className='hero__name'>{APP_NAME}</View>
        <View className='hero__en'>{APP_NAME_EN}</View>
        {ready && !user && <View className='lead mt8'>挑时间 → 发链接 → 人齐就开</View>}
      </View>

      <View className='mt24'>
        <View className='entry entry--primary' onClick={() => start('/pages/event/create')}>
          <View className='entry__icon'>
            <Icon name='plus' color='#fff' />
          </View>
          <View className='h3 flex1'>我来组一局</View>
          <Icon name='right' />
        </View>
        <View className='entry-pair'>
          <View className='entry-mini' onClick={() => start('/pages/interest/create')}>
            <Icon name='hand' />
            <Text>先举个手</Text>
          </View>
          <View className='entry-mini' onClick={() => start('/pages/ai/index')}>
            <Icon name='chat' />
            <Text>随口说一句</Text>
          </View>
        </View>
      </View>

      {user && allInterests.length > 0 && (
        <>
          <SectionTitle title='有人举手了' />
          {allInterests.map((i) => (
            <InterestCard key={i.id} interest={i} onChange={updateInterest} onRemoved={() => void load()} />
          ))}
        </>
      )}

      {user && events && (events.active.length > 0 || events.past.length > 0) && (
        <>
          <SectionTitle title='最近的局' />
          {events.active.map((e) => (
            <EventRow key={e.code} card={e} />
          ))}
          {events.past.slice(0, 3).map((e) => (
            <EventRow key={e.code} card={e} />
          ))}
        </>
      )}

      <GamesSheet open={setup} firstTime onClose={() => setSetup(false)} />
    </Page>
  )
}

function upsert(list: InterestView[], item: InterestView): InterestView[] {
  return list.some((x) => x.id === item.id) ? list.map((x) => (x.id === item.id ? item : x)) : [item, ...list]
}

function EventRow({ card }: { card: EventCard }) {
  const tone = card.status === 'confirmed' ? 'ok' : card.status === 'open' ? 'brand' : 'gray'
  return (
    <View className='episode' onClick={() => go(eventPath(card.code))}>
      <View className='row gap8'>
        <Tag tone={tone}>{card.statusText}</Tag>
        {card.needsMyResponse && <Tag tone='warn'>等你回话</Tag>}
      </View>
      <View className='episode__title'>
        {card.options.map((o) => o.emoji).join('')} {card.title}
      </View>
      <View className='episode__line'>
        {card.whenText}
        {card.progress ? ` · ${card.progress}` : ''}
      </View>
    </View>
  )
}

function InterestCard(props: { interest: InterestView; onChange: (i: InterestView) => void; onRemoved: () => void }) {
  const i = props.interest
  const [busy, setBusy] = useState(false)
  const isParticipant = i.isMine || i.joinedByMe

  const act = async (fn: () => Promise<{ interest: InterestView }>) => {
    setBusy(true)
    try {
      props.onChange((await fn()).interest)
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card tone={i.ready && isParticipant && i.status === 'active' ? 'ok' : undefined}>
      <View className='row gap12'>
        <Avatar user={i.owner} size='sm' />
        <Text className='flex1 bold'>
          {i.isMine ? '我' : i.owner.nickname} 想玩 {i.emoji} {i.name}
        </Text>
        <Text className={i.ready ? 'small red-text bold' : 'small sub'}>
          {i.headcount}/{i.minPlayers}
        </Text>
      </View>
      <View className='mt8'>
        <Progress value={i.headcount} total={i.minPlayers} ok={i.ready} />
      </View>
      <View className='row gap8 mt12'>
        {i.status === 'converted' && i.convertedEventCode && (
          <Button size='sm' kind='primary' onClick={() => go(eventPath(i.convertedEventCode!))}>
            去看看
          </Button>
        )}
        {i.status === 'active' && i.ready && isParticipant && (
          <Button
            size='sm'
            kind='ok'
            onClick={() => {
              setPrefill({ source: 'interest', interest: i })
              go('/pages/event/create?from=interest')
            }}
          >
            人齐了，定时间
          </Button>
        )}
        {i.status === 'active' && !i.isMine && !i.joinedByMe && (
          <Button size='sm' kind='primary' loading={busy} onClick={() => act(() => post(`/api/interests/${i.id}/join`))}>
            +1
          </Button>
        )}
        {i.status === 'active' && i.joinedByMe && (
          <Button size='sm' kind='outline' loading={busy} onClick={() => act(() => del(`/api/interests/${i.id}/join`))}>
            已 +1
          </Button>
        )}
        {i.status === 'active' && i.isMine && (
          <View
            className='icon-btn icon-btn--bare'
            onClick={async () => {
              if (!(await confirm('把手放下？', '朋友们就看不到了。'))) return
              await post(`/api/interests/${i.id}/withdraw`).catch(toastError)
              props.onRemoved()
            }}
          >
            <Icon name='x' size='sm' color={RED} />
          </View>
        )}
      </View>
    </Card>
  )
}
