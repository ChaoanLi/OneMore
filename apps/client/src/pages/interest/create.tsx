import { t, useLocale } from '../../lib/i18n'
import { Input, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useRef, useState } from 'react'
import type { CirclesResponse, FriendsResponse, InterestView, InterestWhenPreset, MyGame } from '@couju/core'
import { GamesSheet, useMyGames } from '../../components/Games'
import { Icon } from '../../components/Icon'
import { Page } from '../../components/Page'
import { Button, Chip, Segmented, SectionTitle, Stepper } from '../../components/ui'
import { get, post } from '../../lib/api'
import { requireUser } from '../../lib/session'
import { back, toast, toastError } from '../../lib/ui'

const WHEN: { key: InterestWhenPreset; label: string }[] = [
  { key: 'tonight', label: '今晚' },
  { key: 'this_weekend', label: '这周末' },
  { key: 'weekday_evenings', label: '工作日晚上' },
  { key: 'next_week', label: '下周' },
  { key: 'anytime', label: '随时' },
]

/** 先举个手：只说想玩什么，不定时间、不用组织 */
export default function CreateInterest() {
  const locale = useLocale()
  const { games } = useMyGames()
  const hydrated = useRef(false)
  const audienceEdited = useRef(false)
  const [game, setGame] = useState<MyGame | null>(null)
  const [minPlayers, setMinPlayers] = useState(4)
  const [whenPreset, setWhenPreset] = useState<InterestWhenPreset>('this_weekend')
  const [note, setNote] = useState('')
  const [audience, setAudience] = useState<'favorites' | 'friends' | 'circles'>('favorites')
  const [circleIds, setCircleIds] = useState<string[]>([])
  const [friends, setFriends] = useState<FriendsResponse | null>(null)
  const [circles, setCircles] = useState<CirclesResponse['circles']>([])
  const [gamesOpen, setGamesOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    Promise.all([get<FriendsResponse>('/api/friends'), get<CirclesResponse>('/api/circles')])
      .then(([f, c]) => {
        setFriends(f)
        setCircles(c.circles)
        if (!hydrated.current && !audienceEdited.current && f.friends.every((x) => !x.favorite)) setAudience('friends')
        hydrated.current = true
      })
      .catch(() => undefined)
  }, [locale])

  useEffect(() => {
    if (!game && games[0]) pick(games[0])
  }, [games])

  const pick = (g: MyGame) => {
    setGame(g)
    setMinPlayers(Math.max(2, g.minPlayers))
  }

  const count =
    audience === 'favorites'
      ? (friends?.friends.filter((f) => f.favorite).length ?? 0)
      : audience === 'friends'
        ? (friends?.friends.length ?? 0)
        : new Set(circles.filter((c) => circleIds.includes(c.id)).flatMap((c) => c.memberIds)).size

  const submit = async () => {
    if (!(await requireUser())) return
    if (!game) return toast(t('想玩什么？'))
    if (audience === 'circles' && circleIds.length === 0) return toast(t('选一个圈子'))
    setBusy(true)
    try {
      await post<{ interest: InterestView }>('/api/interests', {
        gameKey: game.gameKey,
        name: game.gameKey ? '' : game.name,
        emoji: game.emoji,
        minPlayers,
        whenPreset,
        note: note.trim(),
        audience: audience === 'circles' ? { kind: 'circles', circleIds } : { kind: audience },
        ttlDays: 3,
      })
      toast(count > 0 ? t('举起来了，{0} 位朋友看得到', count) : t('举起来了'))
      void Taro.redirectTo({ url: '/pages/index/index' })
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page
      footer={
        <Button kind='primary' block size='lg' loading={busy} onClick={submit}>
          {t('举手')}
        </Button>
      }
    >
      <View className='row row--between'>
        <View className='h1'>{t('先举个手')}</View>
        <Icon name='x' onClick={() => back()} />
      </View>
      <View className='sub mt8'>{t('不定时间、不用组织，凑够人会提醒大家。')}</View>

      <SectionTitle title={t('想玩什么')} />
      <View className='row wrap gap8'>
        {games.map((g) => (
          <Chip key={g.id} on={game?.id === g.id} onClick={() => pick(g)}>
            {g.emoji} {g.name}
          </Chip>
        ))}
        <View className='chip chip--dashed' onClick={() => setGamesOpen(true)}>
          <Icon name='plus' size='sm' color='#6b6b6b' />
        </View>
      </View>
      <View className='switch-row mt8'>
        <Text className='sub'>{t('凑够几个人提醒大家')}</Text>
        <Stepper value={minPlayers} min={2} max={20} onChange={setMinPlayers} />
      </View>

      <SectionTitle title={t('大概什么时候')} />
      <View className='row wrap gap8'>
        {WHEN.map((w) => (
          <Chip key={w.key} small on={whenPreset === w.key} onClick={() => setWhenPreset(w.key)}>
            {t(w.label)}
          </Chip>
        ))}
      </View>
      <Input
        className='input mt12'
        placeholder={t('补一句（可选）')}
        maxlength={100}
        value={note}
        onInput={(e) => setNote(e.detail.value)}
      />

      <SectionTitle title={t('给谁看')} extra={<Text className='sub small'>{t('{0} 人', count)}</Text>} />
      <Segmented
        value={audience}
        onChange={(value) => {
          audienceEdited.current = true
          setAudience(value)
        }}
        options={[
          { value: 'favorites', label: t('常玩的') },
          { value: 'friends', label: t('所有朋友') },
          ...(circles.length > 0 ? [{ value: 'circles' as const, label: t('圈子') }] : []),
        ]}
      />
      {audience === 'circles' && (
        <View className='row wrap gap8 mt12'>
          {circles.map((c) => (
            <Chip
              key={c.id}
              small
              on={circleIds.includes(c.id)}
              onClick={() => setCircleIds(circleIds.includes(c.id) ? circleIds.filter((x) => x !== c.id) : [...circleIds, c.id])}
            >
              {c.name}
            </Chip>
          ))}
        </View>
      )}

      <GamesSheet open={gamesOpen} onClose={() => setGamesOpen(false)} />
    </Page>
  )
}
