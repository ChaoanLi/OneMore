import { Input, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useLoad } from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import {
  createEventSchema,
  CUSTOM_GAME_EMOJI,
  DEFAULT_TIMEZONE,
  DRAFT_FIELD_LABELS,
  findGame,
  GM_ROLE,
  type CirclesResponse,
  type DraftField,
  type FriendEntry,
  type FriendsResponse,
  type InterestView,
  type MyGame,
  type SlotInput,
} from '@couju/core'
import { GamesSheet, playersText, useMyGames } from '../../components/Games'
import { Icon } from '../../components/Icon'
import { Page } from '../../components/Page'
import { SlotEditor } from '../../components/SlotEditor'
import { Button, Chip, SectionTitle, Sheet, Stepper } from '../../components/ui'
import { get, post } from '../../lib/api'
import { takePrefill } from '../../lib/draftStore'
import { deviceTimezone, requireUser, useSession } from '../../lib/session'
import { back, toast, toastError } from '../../lib/ui'

/** 本局的一个玩法（从“我的游戏”选来，人数可以只对这一局调整） */
interface OptionDraft {
  /** 对应“我的游戏”的 id；AI 草稿里不在我的游戏中的玩法另起 id */
  id: string
  gameKey: string | null
  name: string
  emoji: string
  minPlayers: number
  maxPlayers: number
  needsGm: boolean
}

const fromMyGame = (g: MyGame): OptionDraft => ({ ...g })

type InviteStrategy = 'favorites' | 'friends' | 'circles' | 'link' | null

export default function CreateEvent() {
  const { user } = useSession()
  const tz = user?.timezone ?? DEFAULT_TIMEZONE
  const { games: myGames } = useMyGames()

  const [options, setOptions] = useState<OptionDraft[]>([])
  const [slots, setSlots] = useState<SlotInput[]>([])
  const [inviteOnly, setInviteOnly] = useState(false)
  const [inviteIds, setInviteIds] = useState<string[]>([])
  const [circleIds, setCircleIds] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [note, setNote] = useState('')
  const [offline, setOffline] = useState(false)
  const [location, setLocation] = useState('')
  const [allowWaitlist, setAllowWaitlist] = useState(true)
  const [hostJoins, setHostJoins] = useState(true)
  const [hostGm, setHostGm] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [countsOpen, setCountsOpen] = useState(false)
  const [gamesOpen, setGamesOpen] = useState(false)
  const [uncertain, setUncertain] = useState<DraftField[]>([])
  const [fromAi, setFromAi] = useState(false)
  const [interest, setInterest] = useState<InterestView | null>(null)
  const [pendingStrategy, setPendingStrategy] = useState<{ strategy: InviteStrategy; circleNames: string[] } | null>(null)
  const [friends, setFriends] = useState<FriendEntry[]>([])
  const [circles, setCircles] = useState<CirclesResponse['circles']>([])
  const [submitting, setSubmitting] = useState(false)

  useLoad(() => {
    const prefill = takePrefill()
    if (prefill?.source === 'ai') {
      const s = prefill.suggestion
      setFromAi(true)
      setOptions(
        s.options.map((o) => ({
          id: o.gameKey ?? `ai_${o.name}`,
          gameKey: o.gameKey,
          name: o.name,
          emoji: o.emoji ?? CUSTOM_GAME_EMOJI,
          minPlayers: o.minPlayers,
          maxPlayers: o.maxPlayers,
          needsGm: (o.roles ?? []).some((r) => r.key === 'gm'),
        })),
      )
      setSlots(s.slots)
      setTitle(s.title)
      setNote(s.note)
      setOffline(s.mode === 'offline')
      setInviteOnly(s.visibility === 'invited')
      setUncertain(s.uncertain)
      setPendingStrategy({ strategy: s.inviteStrategy, circleNames: s.circleNames })
    } else if (prefill?.source === 'interest') {
      const i = prefill.interest
      setInterest(i)
      const g = findGame(i.gameKey)
      setOptions([
        {
          id: i.gameKey ?? `interest_${i.id}`,
          gameKey: i.gameKey,
          name: i.name,
          emoji: i.emoji,
          minPlayers: i.minPlayers,
          maxPlayers: Math.max(i.minPlayers, g?.maxPlayers ?? 6),
          needsGm: !!g?.roles.some((r) => r.key === 'gm'),
        },
      ])
      setInviteOnly(true)
      setTitle(`${i.whenHint ? `${i.whenHint} ` : ''}${i.name}`)
    }
  })

  useEffect(() => {
    if (!user) return
    Promise.all([get<FriendsResponse>('/api/friends'), get<CirclesResponse>('/api/circles')])
      .then(([f, c]) => {
        setFriends(f.friends)
        setCircles(c.circles)
      })
      .catch(toastError)
  }, [user?.id])

  // AI 草稿里的邀请策略：好友加载后预选（仍需用户确认）
  useEffect(() => {
    if (!pendingStrategy || friends.length === 0) return
    const { strategy, circleNames } = pendingStrategy
    if (strategy === 'favorites') setInviteIds(friends.filter((f) => f.favorite).map((f) => f.user.id))
    if (strategy === 'friends') setInviteIds(friends.map((f) => f.user.id))
    if (strategy === 'circles') setCircleIds(circles.filter((c) => circleNames.some((n) => c.name.includes(n) || n.includes(c.name))).map((c) => c.id))
    setPendingStrategy(null)
  }, [pendingStrategy, friends, circles])

  // 游戏条：我的游戏 + 本局已选但不在我的游戏里的（比如 AI 识别出来的）
  const chips = useMemo(() => {
    const extra = options.filter((o) => !myGames.some((g) => g.id === o.id || (o.gameKey && g.gameKey === o.gameKey)))
    return [...myGames.map(fromMyGame), ...extra]
  }, [myGames, options])
  const selectedIndex = (c: OptionDraft) => options.findIndex((o) => o.id === c.id || (!!o.gameKey && o.gameKey === c.gameKey))
  const toggleGame = (c: OptionDraft) => {
    const i = selectedIndex(c)
    if (i >= 0) setOptions(options.filter((_, j) => j !== i))
    else if (options.length >= 6) toast('最多 6 种玩法')
    else setOptions([...options, { ...c }])
  }
  const patchOption = (id: string, p: Partial<OptionDraft>) =>
    setOptions(
      options.map((o) => {
        if (o.id !== id) return o
        const n = { ...o, ...p }
        if (n.minPlayers > n.maxPlayers) {
          if (p.minPlayers !== undefined) n.maxPlayers = n.minPlayers
          else n.minPlayers = n.maxPlayers
        }
        return n
      }),
    )

  const durationMin = Math.max(120, ...options.map((o) => findGame(o.gameKey)?.defaultDurationMin ?? 120))
  const compareZones = useMemo(() => {
    const zones = [...new Set(friends.map((f) => f.user.timezone).filter((z) => z !== tz))]
    if (zones.length === 0 && tz !== DEFAULT_TIMEZONE) zones.push(DEFAULT_TIMEZONE)
    if (zones.length === 0 && deviceTimezone() !== tz) zones.push(deviceTimezone())
    return zones
  }, [friends, tz])

  const notifyCount = useMemo(() => {
    const ids = new Set(inviteIds)
    for (const c of circles) if (circleIds.includes(c.id)) c.memberIds.forEach((m) => ids.add(m))
    return ids.size
  }, [inviteIds, circleIds, circles])
  const favorites = friends.filter((f) => f.favorite)
  const needsGmAny = options.some((o) => o.needsGm)
  const toggleId = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  const flag = (f: DraftField) => uncertain.includes(f) && <Text className='hint-ai'>帮忙看看</Text>

  const submit = async () => {
    if (!(await requireUser('先让朋友知道你是谁'))) return
    const payload = {
      title: title.trim(),
      note: note.trim(),
      mode: offline ? ('offline' as const) : ('online' as const),
      location: offline ? location.trim() : '',
      options: options.map((o) => ({
        gameKey: o.gameKey,
        name: o.name,
        emoji: o.emoji,
        minPlayers: o.minPlayers,
        maxPlayers: o.maxPlayers,
        roles: o.needsGm ? [GM_ROLE] : [],
      })),
      slots,
      visibility: inviteOnly ? ('invited' as const) : ('link' as const),
      invite: { userIds: inviteIds, circleIds },
      allowWaitlist,
      sourceInterestId: interest?.id ?? null,
      hostJoins,
      hostRoles: hostJoins && hostGm ? ['gm'] : [],
    }
    const check = createEventSchema.safeParse(payload)
    if (!check.success) return toast(check.error.issues[0]?.message ?? '还有没填好的')
    setSubmitting(true)
    try {
      const { code } = await post<{ code: string }>('/api/events', payload)
      void Taro.redirectTo({ url: `/pages/event/detail?code=${code}&created=1` })
    } catch (e) {
      toastError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Page
      footer={
        <Button kind='primary' block size='lg' loading={submitting} disabled={options.length === 0 || slots.length === 0} onClick={submit}>
          {notifyCount > 0 ? `开局，叫上 ${notifyCount} 人` : '开局，拿链接'}
        </Button>
      }
    >
      <View className='row row--between'>
        <View className='h1'>我来组一局</View>
        <Icon name='x' onClick={() => back()} />
      </View>
      {fromAi && (
        <View className='sub mt8'>
          ✨ 照你说的填好了{uncertain.length > 0 ? `，这几项帮忙看看：${uncertain.map((f) => DRAFT_FIELD_LABELS[f]).join('、')}` : ''}
        </View>
      )}
      {interest && (
        <View className='sub mt8'>
          {interest.emoji} {interest.name} 人齐了，+1 的人会自动收到邀请
        </View>
      )}

      <SectionTitle
        title='玩什么'
        extra={
          options.length > 0 ? (
            <Text className='link small' onClick={() => setCountsOpen(true)}>
              调整人数
            </Text>
          ) : undefined
        }
      />
      {flag('options')}
      <View className='row wrap gap8'>
        {chips.map((c) => {
          const i = selectedIndex(c)
          const sel = i >= 0 ? options[i]! : null
          return (
            <Chip key={c.id} on={!!sel} onClick={() => toggleGame(c)}>
              {c.emoji} {c.name}
              {sel ? <Text className='chip__meta'>{playersText(sel)}</Text> : null}
            </Chip>
          )
        })}
        <View className='chip chip--dashed' onClick={() => setGamesOpen(true)}>
          <Icon name='plus' size='sm' color='#6b6b6b' />
        </View>
      </View>

      <SectionTitle title='什么时候' />
      {flag('when')}
      <SlotEditor tz={tz} durationMin={durationMin} value={slots} onChange={setSlots} compareZones={compareZones} />

      {friends.length > 0 && (
        <>
          <SectionTitle title='叫谁' />
          {flag('invite')}
          <View className='row wrap gap8'>
            {favorites.length > 0 && (
              <Chip
                small
                on={favorites.every((f) => inviteIds.includes(f.user.id))}
                onClick={() => {
                  const all = favorites.every((f) => inviteIds.includes(f.user.id))
                  setInviteIds(all ? inviteIds.filter((id) => !favorites.some((f) => f.user.id === id)) : [...new Set([...inviteIds, ...favorites.map((f) => f.user.id)])])
                }}
              >
                ⭐ 常玩的
              </Chip>
            )}
            {circles.map((c) => (
              <Chip key={c.id} small on={circleIds.includes(c.id)} onClick={() => setCircleIds(toggleId(circleIds, c.id))}>
                {c.name}
              </Chip>
            ))}
            {friends.map((f) => (
              <Chip key={f.user.id} small on={inviteIds.includes(f.user.id)} onClick={() => setInviteIds(toggleId(inviteIds, f.user.id))}>
                {f.user.avatar} {f.user.nickname}
              </Chip>
            ))}
          </View>
          <View className='switch-row mt8'>
            <Text className='sub'>只让选中的人看到</Text>
            <Switch color='#FF2B2B' checked={inviteOnly} onChange={(e) => setInviteOnly(e.detail.value)} />
          </View>
        </>
      )}

      <View className='center mt24'>
        <Text className='link' onClick={() => setMoreOpen(true)}>
          更多设置
        </Text>
      </View>

      {/* 本局人数 */}
      <Sheet open={countsOpen} onClose={() => setCountsOpen(false)} title='这局几个人'>
        {options.map((o) => (
          <View key={o.id} className='mt12'>
            <View className='bold'>
              {o.emoji} {o.name}
            </View>
            <View className='switch-row'>
              <Text className='sub'>最少</Text>
              <Stepper value={o.minPlayers} min={1} max={50} onChange={(v) => patchOption(o.id, { minPlayers: v })} />
            </View>
            <View className='switch-row'>
              <Text className='sub'>最多</Text>
              <Stepper value={o.maxPlayers} min={1} max={50} onChange={(v) => patchOption(o.id, { maxPlayers: v })} />
            </View>
            <View className='switch-row'>
              <Text className='sub'>需要 KP/GM</Text>
              <Switch color='#FF2B2B' checked={o.needsGm} onChange={(e) => patchOption(o.id, { needsGm: e.detail.value })} />
            </View>
          </View>
        ))}
        <Button kind='primary' block className='mt16' onClick={() => setCountsOpen(false)}>
          好了
        </Button>
      </Sheet>

      {/* 更多设置 */}
      <Sheet open={moreOpen} onClose={() => setMoreOpen(false)} title='更多设置'>
        <Input className='input mt12' placeholder={options.length ? `标题（默认：${options.map((o) => o.name).join(' / ')}）` : '标题'} maxlength={40} value={title} onInput={(e) => setTitle(e.detail.value)} />
        <Textarea className='textarea mt8' placeholder='备注，比如：雀魂友人场' maxlength={300} value={note} onInput={(e) => setNote(e.detail.value)} />
        <View className='switch-row mt8'>
          <Text>线下见面</Text>
          <Switch color='#FF2B2B' checked={offline} onChange={(e) => setOffline(e.detail.value)} />
        </View>
        {offline && <Input className='input' placeholder='地点（可以之后再定）' maxlength={80} value={location} onInput={(e) => setLocation(e.detail.value)} />}
        <View className='switch-row'>
          <Text>我也参加</Text>
          <Switch color='#FF2B2B' checked={hostJoins} onChange={(e) => setHostJoins(e.detail.value)} />
        </View>
        {hostJoins && needsGmAny && (
          <View className='switch-row'>
            <Text>我来当 KP/GM</Text>
            <Switch color='#FF2B2B' checked={hostGm} onChange={(e) => setHostGm(e.detail.value)} />
          </View>
        )}
        <View className='switch-row'>
          <Text>人满了可以排候补</Text>
          <Switch color='#FF2B2B' checked={allowWaitlist} onChange={(e) => setAllowWaitlist(e.detail.value)} />
        </View>
        <Button kind='primary' block className='mt16' onClick={() => setMoreOpen(false)}>
          好了
        </Button>
      </Sheet>

      <GamesSheet open={gamesOpen} onClose={() => setGamesOpen(false)} />
    </Page>
  )
}
