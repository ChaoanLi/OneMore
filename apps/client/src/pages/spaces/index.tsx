import { Input, View } from '@tarojs/components'
import { useDidShow, useRouter } from '@tarojs/taro'
import { useState } from 'react'
import type { PublicUser, SpaceJoinRequest } from '@couju/core'
import { Page } from '../../components/Page'
import { Avatar, Button, Card } from '../../components/ui'
import { get, post, del } from '../../lib/api'
import { bootSession, getSession, refreshSpaces, requireUser, selectSpace, useSession } from '../../lib/session'
import { appUrl, confirm, copyText, toastError, toastOk } from '../../lib/ui'

type Member = { userId: string; role: 'owner' | 'member'; user: PublicUser }
type Request = SpaceJoinRequest & { user: PublicUser }
export default function Spaces() {
  const session = useSession()
  const params = useRouter().params
  const [name, setName] = useState('')
  const [invite, setInvite] = useState(params.invite ?? '')
  const [preview, setPreview] = useState<{ space: { id: string; name: string }; status: string | null } | null>(null)
  const [manage, setManage] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [requests, setRequests] = useState<Request[]>([])
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  async function run(fn: () => Promise<void>) {
    if (busy) return
    setBusy(true)
    try {
      await fn()
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  async function loadPreview(token = invite) {
    if (token) setPreview(await get(`/api/space-invites/${encodeURIComponent(token)}`))
  }
  useDidShow(() => {
    void bootSession()
      .then(async () => {
        if (getSession().user) await refreshSpaces()
        if (params.invite) await loadPreview(params.invite)
      })
      .catch(toastError)
  })
  async function loadManage(id: string) {
    const [m, r] = await Promise.all([
      get<{ members: Member[] }>(`/api/spaces/${id}/members`),
      get<{ requests: Request[] }>(`/api/spaces/${id}/requests`),
    ])
    if (manage !== id) setLink('')
    setManage(id)
    setMembers(m.members)
    setRequests(r.requests)
  }
  const ownerSpace = session.spaces.find((s) => s.id === manage)
  return (
    <Page global>
      <View className='hero'>
        <View className='h1'>我的空间</View>
        <View className='muted mt8'>一个账号，分别和不同的朋友组局。</View>
      </View>
      {session.spaces.map((s) => (
        <Card key={s.id} className='mt12'>
          <View className='row row--between'>
            <View>
              <View className='h2'>{s.name}</View>
              <View className='muted small mt4'>
                {s.role === 'owner' ? '我管理的空间' : '已加入'}
                {session.activeSpace === s.id ? ' · 当前空间' : ''}
              </View>
            </View>
            <Button disabled={busy} onClick={() => void run(() => selectSpace(s.id))}>
              进入
            </Button>
          </View>
          {s.role === 'owner' ? (
            <Button kind='ghost' className='mt12' disabled={busy} onClick={() => void run(() => loadManage(s.id))}>
              成员与加入申请
            </Button>
          ) : (
            <Button
              kind='ghost'
              className='mt12'
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (
                    !(await confirm(
                      '退出这个空间？',
                      '你的未来报名会撤回，未结束的主办活动会取消。历史记录保留，重新加入需要批准。',
                      '退出空间',
                    ))
                  )
                    return
                  await post(`/api/spaces/${s.id}/leave`)
                  await refreshSpaces()
                  toastOk('已退出空间')
                })
              }
            >
              退出空间
            </Button>
          )}
        </Card>
      ))}
      {!session.spaces.length && <View className='muted mt16'>还没有加入空间。可以创建自己的空间，或使用朋友发来的邀请链接。</View>}
      <Card className='mt24'>
        <View className='h2'>创建空间</View>
        <Input
          className='input mt12'
          maxlength={30}
          placeholder='例如：周末桌游搭子'
          value={name}
          onInput={(e) => setName(e.detail.value)}
        />
        <Button
          kind='primary'
          className='mt12'
          disabled={!name.trim() || busy}
          onClick={() =>
            void run(async () => {
              if (!(await requireUser('先给你的账号起个名字'))) return
              const r = await post<{ space: { id: string } }>('/api/spaces', { name: name.trim() })
              await refreshSpaces()
              await selectSpace(r.space.id)
            })
          }
        >
          创建独立空间
        </Button>
      </Card>
      <Card className='mt16'>
        <View className='h2'>通过邀请加入</View>
        <View className='muted mt8'>提交申请后，等待空间管理员批准。活动链接不能直接加入空间。</View>
        <Input
          className='input mt12'
          placeholder='粘贴空间邀请链接或邀请码'
          value={invite}
          onInput={(e) => {
            setInvite(e.detail.value)
            setPreview(null)
          }}
        />
        <Button
          className='mt12'
          disabled={!invite.trim() || busy}
          onClick={() =>
            void run(async () => {
              const token = /[?&]invite=([^&#]+)/.exec(invite)?.[1] ?? invite.trim()
              setInvite(token)
              await loadPreview(token)
            })
          }
        >
          查看邀请
        </Button>
        {preview && (
          <View className='mt16'>
            <View className='h2'>{preview.space.name}</View>
            <View className='muted mt8'>
              {preview.status === 'member'
                ? '你已加入这个空间。'
                : preview.status === 'pending'
                  ? '申请已提交，等待管理员批准。'
                  : preview.status === 'rejected'
                    ? '上次申请未通过，可重新申请。'
                    : '管理员批准后才能查看成员和活动。'}
            </View>
            {preview.status === 'member' ? (
              <Button
                className='mt12'
                onClick={() =>
                  void run(async () => {
                    await refreshSpaces()
                    await selectSpace(preview.space.id)
                  })
                }
              >
                进入空间
              </Button>
            ) : (
              <Button
                kind='primary'
                className='mt12'
                disabled={busy || preview.status === 'pending'}
                onClick={() =>
                  void run(async () => {
                    if (!(await requireUser('先登录，再申请加入'))) return
                    await post(`/api/space-invites/${encodeURIComponent(invite)}/requests`)
                    await loadPreview()
                    toastOk('申请已提交')
                  })
                }
              >
                申请加入
              </Button>
            )}
            <Button
              kind='ghost'
              className='mt12'
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (getSession().user) await refreshSpaces()
                  await loadPreview()
                })
              }
            >
              刷新申请状态
            </Button>
          </View>
        )}
      </Card>
      {manage && ownerSpace && (
        <Card className='mt24'>
          <View className='h2'>管理：{ownerSpace.name}</View>
          <View className='muted mt8'>邀请链接只能提交申请。更换链接后，之前的链接立即失效。</View>
          <Button
            className='mt12'
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!(await confirm('生成新的空间邀请链接？', '之前的邀请链接将失效，已经提交的申请仍可处理。', '生成链接'))) return
                const r = await post<{ path: string }>(`/api/spaces/${manage}/invite`)
                const url = appUrl(r.path)
                setLink(url)
                await copyText(url)
              })
            }
          >
            生成 / 更换邀请链接
          </Button>
          {link && (
            <View className='space-link mt12' onClick={() => void copyText(link)}>
              {link}
            </View>
          )}
          <View className='h2 mt24'>加入申请 · {requests.length}</View>
          {requests.map((r) => (
            <View key={r.id} className='space-member mt12'>
              <View className='row gap12'>
                <Avatar user={r.user} />
                <View className='flex1'>
                  {r.user.nickname}
                  <View className='muted small'>@{r.user.handle}</View>
                </View>
              </View>
              <View className='row gap12 mt8'>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await post(`/api/spaces/${manage}/requests/${r.id}/approve`)
                      await loadManage(manage)
                    })
                  }
                >
                  批准
                </Button>
                <Button
                  kind='ghost'
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await post(`/api/spaces/${manage}/requests/${r.id}/reject`)
                      await loadManage(manage)
                    })
                  }
                >
                  拒绝
                </Button>
              </View>
            </View>
          ))}
          {!requests.length && <View className='muted mt8'>没有待处理申请。</View>}
          <View className='h2 mt24'>成员 · {members.length}</View>
          {members.map((m) => (
            <View className='space-member row gap12 mt12' key={m.userId}>
              <Avatar user={m.user} />
              <View className='flex1'>
                {m.user.nickname}
                <View className='muted small'>
                  @{m.user.handle}
                  {m.role === 'owner' ? ' · 管理员' : ''}
                </View>
              </View>
              {m.role !== 'owner' && (
                <Button
                  kind='ghost'
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (!(await confirm('移除这个成员？', '该成员未来报名会撤回，未结束的主办活动会取消；历史记录保留。', '移除成员')))
                        return
                      await del(`/api/spaces/${manage}/members/${m.userId}`)
                      await loadManage(manage)
                    })
                  }
                >
                  移除
                </Button>
              )}
            </View>
          ))}
          <Button kind='ghost' className='mt16' onClick={() => void run(() => loadManage(manage))}>
            刷新成员和申请
          </Button>
        </Card>
      )}
      <View className='muted small mt24'>昵称、头像、账号 ID 和时区在所有空间共用。其他人看不到你加入了哪些空间。</View>
    </Page>
  )
}
