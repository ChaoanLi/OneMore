import { t, useLocale, useLocaleDidShow } from '../../lib/i18n'
import { Input, View } from '@tarojs/components'
import { useRouter } from '@tarojs/taro'
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
  useLocale()
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
  const [justJoined, setJustJoined] = useState(false)
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
    if (!token) return null
    const p = await get<{ space: { id: string; name: string }; status: string | null }>(`/api/space-invites/${encodeURIComponent(token)}`)
    setPreview(p)
    return p
  }
  /** 邀请链接直接加入，组长会收到通知 */
  async function joinInvite(token = invite) {
    if (!(await requireUser('先告诉大家你是谁，再加入组'))) return
    const r = await post<{ joined: boolean }>(`/api/space-invites/${encodeURIComponent(token)}/requests`)
    await refreshSpaces()
    setJustJoined(r.joined)
    await loadPreview(token)
  }
  useLocaleDidShow(() => {
    void bootSession()
      .then(async () => {
        if (getSession().user) await refreshSpaces()
        if (!params.invite) return
        const p = await loadPreview(params.invite)
        // 已经有身份的人打开邀请链接就直接加入
        if (p && p.status !== 'member' && getSession().user) await joinInvite(params.invite)
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
        <View className='h1'>{t('我的空间')}</View>
        <View className='muted mt8'>{t('一个账号，分别和不同的朋友组局。')}</View>
      </View>
      {session.spaces.map((s) => (
        <Card key={s.id} className='mt12'>
          <View className='row row--between'>
            <View>
              <View className='h2'>{s.name}</View>
              <View className='muted small mt4'>
                {s.role === 'owner' ? t('我管理的空间') : t('已加入')}
                {session.activeSpace === s.id ? t(' · 当前空间') : ''}
              </View>
            </View>
            <Button disabled={busy} onClick={() => void run(() => selectSpace(s.id))}>
              {t('进入')}
            </Button>
          </View>
          {s.role === 'owner' ? (
            <Button kind='ghost' className='mt12' disabled={busy} onClick={() => void run(() => loadManage(s.id))}>
              {t('成员与加入申请')}
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
                      t('退出这个空间？'),
                      t('你的未来报名会撤回，未结束的主办活动会取消。历史记录保留，重新加入需要批准。'),
                      t('退出空间'),
                    ))
                  )
                    return
                  await post(`/api/spaces/${s.id}/leave`)
                  await refreshSpaces()
                  toastOk(t('已退出空间'))
                })
              }
            >
              {t('退出空间')}
            </Button>
          )}
        </Card>
      ))}
      {!session.spaces.length && <View className='muted mt16'>{t('还没有加入空间。可以创建自己的空间，或使用朋友发来的邀请链接。')}</View>}
      <Card className='mt24'>
        <View className='h2'>{t('创建空间')}</View>
        <Input
          className='input mt12'
          maxlength={30}
          placeholder={t('例如：周末桌游搭子')}
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
          {t('创建独立空间')}
        </Button>
      </Card>
      <Card className='mt16'>
        <View className='h2'>{t('通过邀请加入')}</View>
        <View className='muted mt8'>{t('打开朋友发来的邀请链接或局的链接，就能直接加入。')}</View>
        <Input
          className='input mt12'
          placeholder={t('粘贴空间邀请链接或邀请码')}
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
          {t('查看邀请')}
        </Button>
        {preview && (
          <View className='mt16'>
            <View className='h2'>{preview.space.name}</View>
            <View className='muted mt8'>
              {preview.status === 'member'
                ? justJoined
                  ? t('✓ 你已加入「{0}」，组长已收到通知。', preview.space.name)
                  : t('你已加入这个空间。')
                : t('点一下就能加入，组长会收到通知。')}
            </View>
            {preview.status === 'member' ? (
              <Button
                kind='primary'
                className='mt12'
                onClick={() =>
                  void run(async () => {
                    await refreshSpaces()
                    await selectSpace(preview.space.id)
                  })
                }
              >
                {t('进入空间')}
              </Button>
            ) : (
              <Button kind='primary' className='mt12' disabled={busy} onClick={() => void run(() => joinInvite())}>
                {t('加入「{0}」', preview.space.name)}
              </Button>
            )}
          </View>
        )}
      </Card>
      {manage && ownerSpace && (
        <Card className='mt24'>
          <View className='h2'>{t('管理：{0}', ownerSpace.name)}</View>
          <View className='muted mt8'>{t('拿到链接的人可以直接加入。更换链接后，之前的链接立即失效。')}</View>
          <Button
            className='mt12'
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (!(await confirm(t('生成新的空间邀请链接？'), t('之前的邀请链接将失效。'), t('生成链接'))))
                  return
                const r = await post<{ path: string }>(`/api/spaces/${manage}/invite`)
                const url = appUrl(r.path)
                setLink(url)
                await copyText(url)
              })
            }
          >
            {t('生成 / 更换邀请链接')}
          </Button>
          {link && (
            <View className='space-link mt12' onClick={() => void copyText(link)}>
              {link}
            </View>
          )}
          <View className='h2 mt24'>{t('加入申请 · {0}', requests.length)}</View>
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
                  {t('批准')}
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
                  {t('拒绝')}
                </Button>
              </View>
            </View>
          ))}
          {!requests.length && <View className='muted mt8'>{t('没有待处理申请。')}</View>}
          <View className='h2 mt24'>{t('成员 · {0}', members.length)}</View>
          {members.map((m) => (
            <View className='space-member row gap12 mt12' key={m.userId}>
              <Avatar user={m.user} />
              <View className='flex1'>
                {m.user.nickname}
                <View className='muted small'>
                  @{m.user.handle}
                  {m.role === 'owner' ? t(' · 管理员') : ''}
                </View>
              </View>
              {m.role !== 'owner' && (
                <Button
                  kind='ghost'
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      if (
                        !(await confirm(
                          t('移除这个成员？'),
                          t('该成员未来报名会撤回，未结束的主办活动会取消；历史记录保留。'),
                          t('移除成员'),
                        ))
                      )
                        return
                      await del(`/api/spaces/${manage}/members/${m.userId}`)
                      await loadManage(manage)
                    })
                  }
                >
                  {t('移除')}
                </Button>
              )}
            </View>
          ))}
          <Button kind='ghost' className='mt16' onClick={() => void run(() => loadManage(manage))}>
            {t('刷新成员和申请')}
          </Button>
        </Card>
      )}
      <View className='muted small mt24'>{t('昵称、头像、账号 ID 和时区在所有空间共用。其他人看不到你加入了哪些空间。')}</View>
    </Page>
  )
}
