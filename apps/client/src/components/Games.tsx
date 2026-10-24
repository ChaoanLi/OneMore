import { t, useLocale, localizeBuiltinGame } from '../lib/i18n'
import { Input, Switch, Text, View } from '@tarojs/components'
import Taro from '@tarojs/taro'
import { useEffect, useState } from 'react'
import { GAME_CATALOG, GAME_EMOJIS, myGameFromCatalog, resolveMyGames, type MyGame, type User } from '@couju/core'
import { patch } from '../lib/api'
import { setUser, useSession } from '../lib/session'
import { toast, toastError } from '../lib/ui'
import { Icon } from './Icon'
import { Button, Chip, Sheet, Stepper, cx } from './ui'

/** “我的游戏”：首次设置 + 自定义添加 + 改默认人数 */

const SKIP_KEY = 'couju.gamesSetupSkipped'

export function useMyGames() {
  useLocale()
  const { user } = useSession()
  return {
    games: resolveMyGames(user?.myGames).map(localizeBuiltinGame),
    isSet: !!user?.myGames && user.myGames.length > 0,
    async save(list: MyGame[]) {
      const r = await patch<{ user: User }>('/api/me', { myGames: list })
      setUser(r.user, ['myGames', 'games'])
      return r.user
    },
  }
}

export function shouldOfferSetup(user: User | null): boolean {
  if (!user || (user.myGames && user.myGames.length > 0)) return false
  try {
    return Taro.getStorageSync(SKIP_KEY) !== '1'
  } catch {
    return false
  }
}

export const playersText = (g: Pick<MyGame, 'minPlayers' | 'maxPlayers'>) =>
  g.minPlayers === g.maxPlayers ? t('{0}人', g.minPlayers) : t('{0}-{1}人', g.minPlayers, g.maxPlayers)

const newId = () => `g_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 新建 / 编辑一个游戏 */
export function GameEditor(props: {
  open: boolean
  initial?: MyGame | null
  onSave: (g: MyGame) => void
  onDelete?: () => void
  onClose: () => void
}) {
  useLocale()
  const blank: MyGame = { id: '', gameKey: null, name: '', emoji: '🎮', minPlayers: 2, maxPlayers: 6, needsGm: false }
  const [g, setG] = useState<MyGame>(props.initial ?? blank)
  useEffect(() => {
    if (props.open) setG(props.initial ?? blank)
  }, [props.open])
  const set = (patch: Partial<MyGame>) =>
    setG((x) => {
      const n = { ...x, ...patch }
      if (n.minPlayers > n.maxPlayers) patch.minPlayers !== undefined ? (n.maxPlayers = n.minPlayers) : (n.minPlayers = n.maxPlayers)
      return n
    })
  const isCatalog = !!g.gameKey
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.initial ? t('改一下') : t('加个游戏')}>
      {!isCatalog && (
        <>
          <View className='row wrap gap8 mt12'>
            {GAME_EMOJIS.map((e) => (
              <View key={e} className={cx('emoji-pick', g.emoji === e && 'emoji-pick--on')} onClick={() => set({ emoji: e })}>
                {e}
              </View>
            ))}
          </View>
          <Input
            className='input mt12'
            placeholder={t('叫什么，比如：剧本杀')}
            maxlength={20}
            value={localizeBuiltinGame(g).name}
            onInput={(e) => set({ name: e.detail.value })}
          />
        </>
      )}
      {isCatalog && (
        <View className='h3 mt12'>
          {g.emoji} {localizeBuiltinGame(g).name}
        </View>
      )}
      <View className='switch-row mt8'>
        <Text>{t('最少几人')}</Text>
        <Stepper value={g.minPlayers} min={1} max={50} onChange={(v) => set({ minPlayers: v })} />
      </View>
      <View className='switch-row'>
        <Text>{t('最多几人')}</Text>
        <Stepper value={g.maxPlayers} min={1} max={50} onChange={(v) => set({ maxPlayers: v })} />
      </View>
      <View className='switch-row'>
        <Text>{t('需要 KP/GM')}</Text>
        <Switch color='#FF2B2B' checked={g.needsGm} onChange={(e) => set({ needsGm: e.detail.value })} />
      </View>
      <Button
        kind='primary'
        block
        className='mt16'
        disabled={!g.name.trim()}
        onClick={() => props.onSave({ ...g, name: g.name.trim(), id: g.id || newId() })}
      >
        {t('好了')}
      </Button>
      {props.onDelete && (
        <View className='center mt12'>
          <Text className='link small' onClick={props.onDelete}>
            {t('不玩这个了')}
          </Text>
        </View>
      )}
    </Sheet>
  )
}

/** 管理我的游戏（首次设置与“我”页共用） */
export function GamesSheet(props: { open: boolean; onClose: () => void; firstTime?: boolean }) {
  useLocale()
  const { games, isSet, save } = useMyGames()
  const [list, setList] = useState<MyGame[]>([])
  const [editing, setEditing] = useState<MyGame | null | undefined>(undefined) // undefined = 关闭；null = 新建
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (props.open) setList(isSet ? games : [])
  }, [props.open])

  const has = (key: string) => list.some((g) => g.gameKey === key)
  const toggleCatalog = (key: string) => {
    const tpl = GAME_CATALOG.find((g) => g.key === key)!
    setList(has(key) ? list.filter((g) => g.gameKey !== key) : [...list, myGameFromCatalog(tpl)])
  }
  const done = async () => {
    if (list.length === 0) {
      toast(t('至少选一个'))
      return
    }
    setBusy(true)
    try {
      await save(list)
      props.onClose()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  const skip = () => {
    try {
      Taro.setStorageSync(SKIP_KEY, '1')
    } catch {
      // 忽略
    }
    props.onClose()
  }

  return (
    <>
      <Sheet
        open={props.open && editing === undefined}
        onClose={props.firstTime ? skip : props.onClose}
        title={props.firstTime ? t('你们常玩什么？') : t('我的游戏')}
      >
        {props.firstTime && <View className='sub mt4'>{t('选好了，组局时只显示这些。随时能改。')}</View>}
        <View className='row wrap gap8 mt12'>
          {GAME_CATALOG.map((g) => (
            <Chip key={g.key} on={has(g.key)} onClick={() => toggleCatalog(g.key)}>
              {g.emoji} {localizeBuiltinGame(g).name}
            </Chip>
          ))}
          {list
            .filter((g) => !g.gameKey)
            .map((g) => (
              <Chip key={g.id} on onClick={() => setEditing(g)}>
                {g.emoji} {localizeBuiltinGame(g).name}
              </Chip>
            ))}
          <View className='chip chip--dashed' onClick={() => setEditing(null)}>
            <Icon name='plus' size='sm' color='#6b6b6b' />
            <Text className='ml4'>{t('自己加')}</Text>
          </View>
        </View>

        {list.length > 0 && (
          <View className='mt16'>
            {list.map((g) => (
              <View key={g.id} className='list-row' onClick={() => setEditing(g)}>
                <Text className='flex1'>
                  {g.emoji} {localizeBuiltinGame(g).name}
                </Text>
                <Text className='muted'>
                  {playersText(g)}
                  {g.needsGm ? t(' · KP') : ''}
                </Text>
                <Icon name='right' size='sm' color='#a8a8a8' />
              </View>
            ))}
          </View>
        )}

        <Button kind='primary' block size='lg' className='mt16' loading={busy} onClick={done}>
          {t('就这些')}
        </Button>
        {props.firstTime && (
          <View className='center mt12'>
            <Text className='muted' onClick={skip}>
              {t('以后再说')}
            </Text>
          </View>
        )}
      </Sheet>
      <GameEditor
        open={props.open && editing !== undefined}
        initial={editing}
        onClose={() => setEditing(undefined)}
        onSave={(g) => {
          setList(list.some((x) => x.id === g.id) ? list.map((x) => (x.id === g.id ? g : x)) : [...list, g])
          setEditing(undefined)
        }}
        onDelete={
          editing
            ? () => {
                setList(list.filter((x) => x.id !== editing.id))
                setEditing(undefined)
              }
            : undefined
        }
      />
    </>
  )
}
