import { Input, Text, View } from '@tarojs/components'
import Taro, { useDidShow } from '@tarojs/taro'
import { useState } from 'react'
import { zoneLabel, type CirclesResponse, type FriendsResponse } from '@couju/core'
import { FAINT, Icon, RED } from '../../components/Icon'
import { Page } from '../../components/Page'
import { APP_NAME } from '../../lib/brand'
import { Avatar, Button, Card, Empty, SectionTitle } from '../../components/ui'
import { del, get, patch, post } from '../../lib/api'
import { bootSession, getSession, requireUser, useSession } from '../../lib/session'
import { appUrl, confirm, copyText, go, toast, toastError } from '../../lib/ui'

/** 好友与圈子。常玩标记和圈子都只有自己看得到。 */
export default function Friends() {
  const { user } = useSession()
  const [data, setData] = useState<FriendsResponse | null>(null)
  const [circles, setCircles] = useState<CirclesResponse['circles']>([])
  const [handle, setHandle] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    await bootSession()
    if (!getSession().user) return
    try {
      const [f, c] = await Promise.all([get<FriendsResponse>('/api/friends'), get<CirclesResponse>('/api/circles')])
      setData(f)
      setCircles(c.circles)
    } catch (e) {
      toastError(e)
    }
  }
  useDidShow(() => {
    void load()
  })

  const add = async () => {
    const h = handle.trim().toLowerCase()
    if (!h) return
    setBusy(true)
    try {
      const r = await post<{ status: string; user: { nickname: string } }>('/api/friends', { handle: h })
      toast(r.status === 'accepted' ? `你和 ${r.user.nickname} 已是好友` : `已向 ${r.user.nickname} 发送请求`)
      setHandle('')
      void load()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <Page nav='friends'>
        <View className='h1 mt8'>朋友</View>
        <Card className='mt16'>
          <Empty icon='👥' text='先让朋友知道你是谁，才能加朋友、分圈子'>
            <Button kind='primary' className='mt12' onClick={() => void requireUser().then(() => load())}>
              好的
            </Button>
          </Empty>
        </Card>
      </Page>
    )
  }

  const toggleFavorite = async (id: string, favorite: boolean) => {
    setData((d) => (d ? { ...d, friends: d.friends.map((f) => (f.user.id === id ? { ...f, favorite } : f)) } : d))
    try {
      await patch(`/api/friends/${id}`, { favorite })
    } catch (e) {
      toastError(e)
      void load()
    }
  }

  return (
    <Page nav='friends'>
      <View className='h1 mt8'>朋友</View>

      <Card className='mt16'>
        <View className='row gap12'>
          <Avatar user={user} size='lg' />
          <View className='flex1'>
            <View className='h3'>{user.nickname}</View>
            <View className='sub'>我的 ID：{user.handle}</View>
          </View>
        </View>
        <Button kind='primary' block className='mt12' onClick={() => void copyText(`在「${APP_NAME}」加我好友：${appUrl(`/pages/friends/add?h=${user.handle}`)}`, '复制好了，发给朋友吧')}>
          复制我的加好友链接
        </Button>
        <View className='row gap8 mt12'>
          <Input className='input flex1' placeholder='输入朋友的 ID' value={handle} onInput={(e) => setHandle(e.detail.value)} onConfirm={add} />
          <Button loading={busy} onClick={add}>
            加好友
          </Button>
        </View>
      </Card>

      {data && data.incoming.length > 0 && (
        <>
          <SectionTitle title={`有人想加你（${data.incoming.length}）`} />
          <Card>
            {data.incoming.map((u) => (
              <View key={u.id} className='list-item'>
                <Avatar user={u} />
                <View className='flex1'>
                  <View className='bold'>{u.nickname}</View>
                  <View className='muted'>{u.handle}</View>
                </View>
                <Button
                  size='sm'
                  kind='primary'
                  onClick={async () => {
                    try {
                      await post(`/api/friends/${u.id}/accept`)
                      void load()
                    } catch (e) {
                      toastError(e)
                    }
                  }}
                >
                  加上
                </Button>
                <Button
                  size='sm'
                  kind='ghost'
                  onClick={async () => {
                    await del(`/api/friends/${u.id}`).catch(toastError)
                    void load()
                  }}
                >
                  先不了
                </Button>
              </View>
            ))}
          </Card>
        </>
      )}

      <SectionTitle title={`朋友（${data?.friends.length ?? 0}）`} extra={<Text className='sub small'>星标 = 常一起玩，只有你看得到</Text>} />
      <Card>
        {data && data.friends.length === 0 && <Empty icon='🤝' text='还没有朋友在这儿。把加好友链接丢给他们，或者在局里加一起玩的人。' />}
        {data?.friends.map((f) => (
          <View key={f.user.id} className='list-item'>
            <Avatar user={f.user} />
            <View className='flex1'>
              <View className='bold'>{f.user.nickname}</View>
              <View className='muted'>
                {f.user.handle} · {zoneLabel(f.user.timezone)}
              </View>
            </View>
            <Icon name='star' filled={f.favorite} color={f.favorite ? RED : FAINT} onClick={() => toggleFavorite(f.user.id, !f.favorite)} />
            <View
              className='ml8'
              onClick={async () => {
                const r = await Taro.showActionSheet({ itemList: ['删除好友'] }).catch(() => null)
                if (r?.tapIndex !== 0) return
                if (!(await confirm(`删除 ${f.user.nickname}？`, '对方不会收到通知，也会从你的圈子里移除。', '删除'))) return
                await del(`/api/friends/${f.user.id}`).catch(toastError)
                void load()
              }}
            >
              <Icon name='more' color={FAINT} />
            </View>
          </View>
        ))}
        {data && data.outgoing.length > 0 && (
          <View className='muted mt8'>等对方点头：{data.outgoing.map((u) => u.nickname).join('、')}</View>
        )}
      </Card>

      <SectionTitle
        title='圈子'
        extra={
          <Text className='link small' onClick={() => go('/pages/circle/edit')}>
            ＋ 新建
          </Text>
        }
      />
      <Card>
        {circles.length === 0 && <Empty icon='🫂' text='给常一起玩的人分个组，比如“麻将搭子”“刀塔五黑”，组局时一键叫上。' />}
        {circles.map((c) => (
          <View key={c.id} className='list-item' onClick={() => go(`/pages/circle/edit?id=${c.id}`)}>
            <Icon name='users' />
            <View className='flex1'>
              <View className='bold'>{c.name}</View>
              <View className='muted'>
                {c.memberIds.length} 人 ·{' '}
                {c.memberIds
                  .map((id) => data?.friends.find((f) => f.user.id === id)?.user.nickname)
                  .filter(Boolean)
                  .slice(0, 4)
                  .join('、')}
              </View>
            </View>
            <Text className='muted'>›</Text>
          </View>
        ))}
      </Card>
    </Page>
  )
}
