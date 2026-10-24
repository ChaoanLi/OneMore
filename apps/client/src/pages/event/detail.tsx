import { Button as TaroButton, Input, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useDidShow, useRouter, useShareAppMessage } from '@tarojs/taro'
import { useEffect, useMemo, useState } from 'react'
import {
  DEFAULT_TIMEZONE,
  describeProgress,
  type CirclesResponse,
  type EmailInviteResponse,
  type EmailSettingsResponse,
  type ComboEvaluation,
  type EventView,
  type FriendsResponse,
  type ParticipantView,
  type ResponseIntent,
  type SlotAvailability,
  type SlotInput,
} from '@couju/core'
import { Icon } from '../../components/Icon'
import { Page } from '../../components/Page'
import { SlotCalendar } from '../../components/SlotCalendar'
import { SlotEditor } from '../../components/SlotEditor'
import { Avatar, AvatarStack, Button, Card, Chip, Empty, Loading, Progress, SectionTitle, Sheet, Tag, cx } from '../../components/ui'
import { ApiError, get, post, put } from '../../lib/api'
import { bootSession, requireUser, useSession } from '../../lib/session'
import { APP_NAME } from '../../lib/brand'
import { appUrl, confirm, copyText, eventPath, go, isH5, shareText, toast, toastError, toastOk } from '../../lib/ui'

type ActionResult = { view: EventView; added?: number }

export default function EventDetail() {
  const router = useRouter()
  const code = String(router.params.code ?? '')
  const { user } = useSession()
  const [view, setView] = useState<EventView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shareOpen, setShareOpen] = useState(router.params.created === '1')
  const [editing, setEditing] = useState(false)
  const [slotSheet, setSlotSheet] = useState(false)
  const [inviteSheet, setInviteSheet] = useState(false)
  const [emailSheet, setEmailSheet] = useState(false)

  const load = async () => {
    await bootSession()
    try {
      const v = await get<EventView>(`/api/events/${code}?tz=${encodeURIComponent(DEFAULT_TIMEZONE)}`)
      setView(v)
      setError(null)
      if (isH5) void Taro.setNavigationBarTitle({ title: v.event.title })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '加载失败')
    }
  }
  useDidShow(() => {
    void load()
  })
  useEffect(() => {
    // 分享弹层只在刚创建时自动弹一次：去掉地址里的 created=1，刷新后不再弹
    if (isH5 && router.params.created === '1' && typeof window !== 'undefined') {
      window.history.replaceState(window.history.state, '', window.location.href.replace(/[&?]created=1/, ''))
    }
  }, [])
  useEffect(() => {
    // 刚填完昵称（身份变化）时刷新，拿到“我的报名”等信息
    if (view && user && view.viewer.role === 'anonymous') void load()
  }, [user?.id])

  const shareTitle = view ? `${view.host.nickname} 约你：${view.event.title}` : APP_NAME
  useShareAppMessage(() => ({ title: shareTitle, path: eventPath(code) }))

  /** 发起人/报名者的操作：成功后用服务端返回的最新视图刷新 */
  const act = async (path: string, body?: unknown, okMsg?: string, method: 'post' | 'put' = 'post') => {
    try {
      const res = method === 'put' ? await put<ActionResult>(path, body) : await post<ActionResult>(path, body)
      setView(res.view)
      if (okMsg) toastOk(okMsg)
      return res
    } catch (e) {
      toastError(e)
      return null
    }
  }

  if (error) {
    return (
      <Page>
        <Empty icon='🔍' text={error}>
          <Button kind='primary' className='mt16' onClick={() => void Taro.redirectTo({ url: '/pages/index/index' })}>
            回首页
          </Button>
        </Empty>
      </Page>
    )
  }
  if (!view) {
    return (
      <Page>
        <Loading />
      </Page>
    )
  }

  const { event, viewer } = view
  const isHost = viewer.role === 'host'
  const futureSlots = event.slots.filter((s) => !s.isPast)
  const optionById = new Map(event.options.map((o) => [o.id, o]))
  const slotById = new Map(event.slots.map((s) => [s.id, s]))
  const nameOf = new Map(view.participants.map((p) => [p.user.id, p.user]))
  nameOf.set(view.host.id, view.host)
  const myResp = viewer.response
  const yesOf = (slotId: string) => view.participants.filter((p) => p.intent === 'joined' && p.availability[slotId] === 'yes')
  const maybeOf = (slotId: string) =>
    view.participants.filter((p) => (p.intent === 'joined' || p.intent === 'maybe') && (p.availability[slotId] === 'maybe' || (p.intent === 'maybe' && p.availability[slotId] === 'yes')))
  const feasibleSlots = new Set((view.evaluation?.combos ?? []).filter((c) => c.feasible).map((c) => c.slotId))
  const need = Math.max(1, Math.min(...event.options.map((o) => o.minPlayers)))
  const bestDate = [...futureSlots].sort((a, b) => yesOf(b.id).length - yesOf(a.id).length || a.startUtc.localeCompare(b.startUtc))[0]?.localDate
  const showEditor = viewer.canRespond && !viewer.inRoster && (editing || !myResp) && !(isHost && myResp)

  return (
    <Page
      footer={
        isHost && event.status === 'open' ? (
          <Button kind='primary' block size='lg' onClick={() => setShareOpen(true)}>
            丢到群里
          </Button>
        ) : undefined
      }
    >
      {/* 头部 */}
      <View className='row row--between'>
        <Icon name='left' onClick={() => void Taro.redirectTo({ url: '/pages/index/index' })} />
        {!view.restricted && (event.status === 'open' || event.status === 'confirmed') && <Icon name='share' onClick={() => setShareOpen(true)} />}
      </View>
      <View className='mt12'>
        <View className='row gap8'>
          <Text className='emoji-lg'>{event.options.map((o) => o.emoji).join('')}</Text>
          <Tag tone={event.status === 'confirmed' ? 'ok' : event.status === 'open' ? 'brand' : 'gray'}>{event.statusText}</Tag>
          {event.mode === 'offline' && <Tag tone='info'>线下</Tag>}
        </View>
        <View className='h1 mt8'>{event.title}</View>
        <View className='row gap8 mt8'>
          <Avatar user={view.host} size='sm' />
          <Text className='sub'>{isHost ? '我' : view.host.nickname} 组的局</Text>
          {event.options.length > 1 && <Text className='muted'>· {event.options.length} 种玩法，大家挑</Text>}
        </View>
        {event.note && <View className='sub mt8'>{event.note}</View>}
        {event.location && <View className='sub mt4'>📍 {event.location}</View>}
      </View>

      {view.restricted ? (
        <Card tone='warn' className='mt16'>
          <View className='h3'>🔒 这局只对被邀请的人开放</View>
          <View className='sub mt4'>如果你也想参加，可以先加 {view.host.nickname} 为好友（ID：{view.host.handle}），请 TA 邀请你。</View>
          <Button kind='primary' size='sm' className='mt12' onClick={() => go(`/pages/friends/add?h=${view.host.handle}`)}>
            加 {view.host.nickname} 为好友
          </Button>
        </Card>
      ) : (
        <>
          <StatusBanner view={view} />

          {/* 我的状态 / 报名 */}
          {viewer.inRoster && event.status === 'confirmed' && (
            <RosterCard
              view={view}
              onConfirm={() => act(`/api/events/${code}/final-confirm`, {}, '好，到时见')}
              onWithdraw={async () => {
                if (await confirm('临时有事？', '会告诉组局的人找人补上。没事，下次再约。', '嗯，来不了')) {
                  await act(`/api/events/${code}/withdraw`, {}, '已经告诉组局的人了')
                }
              }}
            />
          )}
          {viewer.inWaitlist && (
            <Card tone='info' className='mt12'>
              <View className='bold'>你在候补第 {(event.final?.waitlistIds.indexOf(user?.id ?? '') ?? 0) + 1} 位</View>
              <View className='sub mt4'>有人临时有事，组局的人会叫你补上，到时会通知你。</View>
            </Card>
          )}
          {!showEditor && myResp && !viewer.inRoster && !viewer.inWaitlist && !isHost && (
            <MyResponse view={view} onEdit={() => setEditing(true)} onWithdraw={() => act(`/api/events/${code}/withdraw`, {}, '已退出')} />
          )}
          {showEditor && (
            <RespondPanel
              view={view}
              onCancel={myResp ? () => setEditing(false) : undefined}
              onSubmit={async (body, okMsg) => {
                const me = await requireUser('报名前，告诉大家你是谁')
                if (!me) return
                const res = await act(`/api/events/${code}/response`, body, undefined, 'put')
                if (res) {
                  setEditing(false)
                  toast(okMsg)
                }
              }}
            />
          )}
          {!viewer.canRespond && !myResp && event.status !== 'open' && !isHost && <View className='muted center mt16'>这局现在不收人了</View>}

          {/* 发起人面板 */}
          {isHost && (
            <HostPanel
              view={view}
              onConfirm={async (combo) => {
                const option = optionById.get(combo.optionId)!
                const slot = slotById.get(combo.slotId)!
                const names = (ids: string[]) => ids.map((id) => nameOf.get(id)?.nickname ?? '?').join('、')
                const ok = await confirm(
                  '就这么定了？',
                  `${option.emoji} ${option.name} · ${slot.line}。名单：${names(combo.roster)}${combo.waitlist.length ? `；候补：${names(combo.waitlist)}` : ''}。定了之后会通知名单里的人。`,
                  '定了',
                )
                if (ok) await act(`/api/events/${code}/confirm`, { optionId: combo.optionId, slotId: combo.slotId }, '成了！')
              }}
              onPromote={(userId) => act(`/api/events/${code}/promote`, { userId }, '已经叫 TA 补上')}
              onReopen={async () => {
                if (await confirm('重新开放报名？', '当前名单会清空，大家的报名保留。')) await act(`/api/events/${code}/reopen`, {}, '已重新开放')
              }}
              onCancel={async () => {
                if (await confirm('取消这局？', '会告诉已经报名的朋友。', '取消这局')) await act(`/api/events/${code}/cancel`, { reason: '' }, '已取消')
              }}
              onAddSlots={() => setSlotSheet(true)}
              onInvite={() => setInviteSheet(true)}
              onEmail={() => setEmailSheet(true)}
              onShare={() => setShareOpen(true)}
            />
          )}

          {/* 大家的时间：日历视图，颜色越深能来的人越多 */}
          {futureSlots.length > 0 && view.participants.length > 0 && event.status === 'open' && (
            <>
              <SectionTitle title='大家的时间' extra={<Text className='sub small'>颜色越深，能来的人越多</Text>} />
              <Card>
                <SlotCalendar
                  slots={futureSlots}
                  initialDate={bestDate}
                  badge={(ds) => {
                    const top = Math.max(...ds.map((x) => yesOf(x.id).length))
                    return { level: top / need, label: top > 0 ? `${top}人` : undefined, mark: ds.some((x) => feasibleSlots.has(x.id)) }
                  }}
                  renderDay={(ds) =>
                    ds.map((x) => {
                      const yes = yesOf(x.id)
                      const maybe = maybeOf(x.id)
                      return (
                        <View key={x.id} className='slot'>
                          <View className='row row--between'>
                            <View className='flex1'>
                              <View className='bold'>
                                {x.dateLabel} {x.timeLabel}
                              </View>
                              {x.hostLine && <View className='muted'>{x.hostLine}</View>}
                            </View>
                            {feasibleSlots.has(x.id) ? <Tag tone='ok'>人齐</Tag> : <Text className='sub'>{yes.length} 人可以</Text>}
                          </View>
                          {(yes.length > 0 || maybe.length > 0) && (
                            <View className='row gap8 mt8'>
                              <AvatarStack users={yes.map((p) => p.user)} max={8} />
                              {maybe.length > 0 && <Text className='muted'>另有 {maybe.length} 人看情况</Text>}
                            </View>
                          )}
                        </View>
                      )
                    })
                  }
                />
              </Card>
            </>
          )}

          {/* 报名情况 */}
          <SectionTitle title={`谁来（${view.participants.filter((p) => p.intent === 'joined').length}）`} />
          <Card>
            {view.participants.length === 0 ? (
              <Empty icon='👋' text='还没人回话。丢到群里试试？' />
            ) : (
              view.participants.map((p) => <ParticipantRow key={p.user.id} p={p} view={view} />)
            )}
            {isHost && view.hostOnly && view.hostOnly.declinedCount > 0 && (
              <View className='muted mt8'>另有 {view.hostOnly.declinedCount} 人这次来不了（不告诉你是谁）</View>
            )}
          </Card>
        </>
      )}

      <ShareSheet open={shareOpen} onClose={() => setShareOpen(false)} view={view} created={router.params.created === '1'} />
      {isHost && (
        <AddSlotsSheet
          open={slotSheet}
          tz={user?.timezone ?? event.hostTimezone}
          onClose={() => setSlotSheet(false)}
          onSave={async (slots) => {
            const res = await act(`/api/events/${code}/slots`, { slots }, '已添加时间')
            if (res) setSlotSheet(false)
          }}
        />
      )}
      {isHost && (
        <InviteSheet
          open={inviteSheet}
          invitedIds={view.hostOnly?.invitees.map((i) => i.user.id) ?? []}
          onClose={() => setInviteSheet(false)}
          onSend={async (userIds, circleIds) => {
            const res = await act(`/api/events/${code}/invite`, { userIds, circleIds })
            if (res) {
              toast(res.added ? `已邀请 ${res.added} 人` : '他们都已经在邀请名单里了')
              setInviteSheet(false)
            }
          }}
        />
      )}
      {isHost && <EmailInviteSheet open={emailSheet} code={code} onClose={() => setEmailSheet(false)} />}
    </Page>
  )
}

/** 用邮件叫还没用 App 的朋友 */
function EmailInviteSheet(props: { open: boolean; code: string; onClose: () => void }) {
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const emails = [...new Set(text.split(/[\s,，;；]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))]
  const REASON: Record<string, string> = { unsubscribed: '对方退订过', duplicate: '24 小时内发过了', rate_limited: '今天发太多了' }
  const send = async () => {
    setBusy(true)
    try {
      const r = await post<EmailInviteResponse>(`/api/events/${props.code}/email-invite`, { emails, message })
      const skipped = r.skipped.map((s) => `${s.email}（${REASON[s.reason]}）`).join('、')
      toast(`${r.transport === 'console' ? '演示模式：' : ''}发出 ${r.sent} 封${skipped ? `；跳过 ${skipped}` : ''}`)
      if (r.sent > 0) {
        setText('')
        setMessage('')
        props.onClose()
      }
    } catch (e) {
      toastError(e)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={props.open} onClose={props.onClose} title='用邮件叫人'>
      <View className='sub mt4'>仅能发给本空间已验证邮箱的成员。新人请先用空间邀请链接申请加入，每封邮件都带退订链接。</View>
      <Textarea className='textarea mt12' placeholder='朋友的邮箱，多个用空格或逗号隔开' maxlength={600} value={text} onInput={(e) => setText(e.detail.value)} />
      <Input className='input mt8' placeholder='附一句话（可选），比如“缺一个，来吗”' maxlength={100} value={message} onInput={(e) => setMessage(e.detail.value)} />
      <View className='muted mt8'>时间按北京时间写，并附上你那边的时间。夜里不发，攒到早上 8:30。</View>
      <Button kind='primary' block className='mt16' loading={busy} disabled={emails.length === 0} onClick={send}>
        {emails.length ? `发给 ${emails.length} 个人` : '发邀请'}
      </Button>
    </Sheet>
  )
}

// ---------------- 状态横幅 ----------------

function StatusBanner({ view }: { view: EventView }) {
  const { event, evaluation } = view
  const isHost = view.viewer.role === 'host'
  const option = (id: string) => event.options.find((o) => o.id === id)
  const slot = (id: string) => event.slots.find((s) => s.id === id)

  if (event.status === 'cancelled') {
    return (
      <Card className='mt16'>
        <View className='h3'>这局取消了</View>
        <View className='sub mt4'>{event.cancelReason || '下次再约～'}</View>
      </Card>
    )
  }
  if (event.status === 'expired') {
    return (
      <Card className='mt16'>
        <View className='h3'>时间都过了，没凑成</View>
        <View className='sub mt4'>{isHost ? '加几个新时间，再试一次？' : '这次没凑成，下次再约～'}</View>
      </Card>
    )
  }
  if ((event.status === 'confirmed' || event.status === 'completed') && event.final) {
    const o = option(event.final.optionId)
    const s = slot(event.final.slotId)
    const check = view.rosterCheck
    return (
      <Card tone={check && !check.ok ? 'warn' : 'ok'} className='mt16'>
        <View className='h2'>{event.status === 'completed' ? '这局结束了' : check && !check.ok ? `有人临时有事，还差 ${check.stillNeed} 个` : '成了！🎉'}</View>
        <View className='bold mt8'>
          {o?.emoji} {o?.name} · {s?.line}
        </View>
        {s?.hostLine && <View className='muted'>{s.hostLine}</View>}
        <View className='mt12'>
          <RosterList view={view} />
        </View>
      </Card>
    )
  }
  if (!evaluation || !evaluation.best) {
    return (
      <Card className='mt16'>
        <View className='sub'>没有能选的时间了{isHost ? '，加几个新时间吧' : ''}</View>
      </Card>
    )
  }
  const best = evaluation.best
  const o = option(best.optionId)!
  const s = slot(best.slotId)!
  return (
    <Card tone={best.feasible ? 'ok' : 'brand'} className='mt16'>
      <View className='row row--between'>
        <Text className='eyebrow'>{best.feasible ? '人齐了' : '眼下最有戏'}</Text>
        <Text className='small bold'>
          {best.eligibleIds.length}/{o.minPlayers === o.maxPlayers ? o.minPlayers : `${o.minPlayers}–${o.maxPlayers}`} 人
        </Text>
      </View>
      <View className='h3 mt4'>
        {o.emoji} {o.name} · {s.line}
      </View>
      {s.hostLine && <View className='muted'>{s.hostLine}</View>}
      <View className='mt8'>
        <Progress value={best.eligibleIds.length} total={o.minPlayers} ok={best.feasible} />
      </View>
      <View className={cx('small mt8', best.feasible ? 'ok-text bold' : 'sub')}>
        {best.feasible ? (isHost ? '人够了，在下面点“就这么定了”' : `人够了，等 ${view.host.nickname} 拍板`) : describeProgress(best)}
        {best.maybeIds.length > 0 && !best.feasible ? `，还有 ${best.maybeIds.length} 人在看情况` : ''}
      </View>
    </Card>
  )
}

function RosterList({ view }: { view: EventView }) {
  const final = view.event.final!
  const byId = new Map(view.participants.map((p) => [p.user.id, p]))
  const roleOf = (id: string) => Object.entries(final.roleAssignments).find(([, ids]) => ids.includes(id))?.[0]
  return (
    <View>
      {final.rosterIds.map((id) => {
        const p = byId.get(id)
        if (!p) return null
        return (
          <View key={id} className='row gap8 mt4'>
            <Avatar user={p.user} size='sm' />
            <Text className='flex1'>
              {p.user.nickname}
              {id === view.host.id ? <Text className='muted'>（组局）</Text> : null}
            </Text>
            {roleOf(id) && <Tag tone='info'>KP/GM</Tag>}
            {p.finalConfirmed ? <Tag tone='ok'>会来</Tag> : <Text className='muted'>还没点头</Text>}
          </View>
        )
      })}
      {final.waitlistIds.length > 0 && (
        <View className='muted mt8'>候补：{final.waitlistIds.map((id) => byId.get(id)?.user.nickname ?? '?').join('、')}</View>
      )}
    </View>
  )
}

// ---------------- 名单成员 ----------------

function RosterCard(props: { view: EventView; onConfirm: () => void; onWithdraw: () => void }) {
  const r = props.view.viewer.response
  if (r?.finalConfirmed) {
    return (
      <Card className='mt12'>
        <View className='row row--between'>
          <Text className='bold ok-text'>✓ 你说了会来</Text>
          {props.view.viewer.role !== 'host' && (
            <Text className='link small' onClick={props.onWithdraw}>
              临时有事
            </Text>
          )}
        </View>
      </Card>
    )
  }
  return (
    <Card className='mt12'>
      <View className='h3'>定了！就等你点个头</View>
      <View className='sub mt4'>点一下，大家就知道你会来。</View>
      <Button kind='ok' block size='lg' className='mt12' onClick={props.onConfirm}>
        我会来
      </Button>
      <View className='center mt8'>
        <Text className='link small' onClick={props.onWithdraw}>
          临时有事，来不了
        </Text>
      </View>
    </Card>
  )
}

/** 报名后温和提示：留个邮箱，成团时能收到邮件（已留过就不显示） */
function EmailHint() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    get<EmailSettingsResponse>('/api/me/email')
      .then((s) => setShow(!s.email))
      .catch(() => undefined)
  }, [])
  if (!show) return null
  return (
    <View className='row gap4 mt8' onClick={() => go('/pages/me/index?email=1')}>
      <Icon name='mail' size='sm' color='#FF2B2B' />
      <Text className='link small'>留个邮箱，成团时告诉你</Text>
    </View>
  )
}

const INTENT_TEXT: Record<ResponseIntent, string> = { joined: '✅ 算上你了', maybe: '🤔 你说看情况', interested: '🙋 你想玩，但时间不太行', declined: '这次就不了，没关系' }

function MyResponse(props: { view: EventView; onEdit: () => void; onWithdraw: () => void }) {
  const r = props.view.viewer.response!
  const yesSlots = props.view.event.slots.filter((s) => r.availability[s.id] === 'yes')
  return (
    <Card className='mt12'>
      <View className='row row--between'>
        <Text className={cx('bold', r.intent === 'joined' && 'ok-text')}>
          {INTENT_TEXT[r.intent]}
        </Text>
        {props.view.viewer.canRespond && (
          <Text className='link' onClick={props.onEdit}>
            {r.intent === 'declined' ? '改主意了' : '改一下'}
          </Text>
        )}
      </View>
      {r.intent === 'joined' && (
        <View className='sub mt4'>
          可以的时间：{yesSlots.map((s) => s.line).join('；')}
        </View>
      )}
      {r.intent === 'joined' && <EmailHint />}
    </Card>
  )
}

// ---------------- 报名面板 ----------------

/** dateLabel 形如“10/24 周六”（已按查看者时区格式化） */
const isWeekendLocal = (dateLabel: string) => /周六|周日/.test(dateLabel)

function RespondPanel(props: {
  view: EventView
  onSubmit: (body: { intent: ResponseIntent; availability: Record<string, SlotAvailability>; optionIds: string[]; roles: string[]; comment: string }, okMsg: string) => Promise<void>
  onCancel?: () => void
}) {
  const { event, viewer } = props.view
  const prev = viewer.response
  const slots = event.slots.filter((s) => !s.isPast)
  const [avail, setAvail] = useState<Record<string, SlotAvailability>>(() => (prev?.intent === 'declined' ? {} : (prev?.availability ?? {})))
  const [optionIds, setOptionIds] = useState<string[]>(prev?.optionIds ?? [])
  const [gm, setGm] = useState(prev?.roles.includes('gm') ?? false)
  const [comment, setComment] = useState(prev?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [showComment, setShowComment] = useState(false)
  const needsGm = event.options.some((o) => o.roles.some((r) => r.key === 'gm'))
  const single = slots.length === 1
  const anyYes = Object.values(avail).includes('yes') || single

  const setSlot = (id: string, v: SlotAvailability) => setAvail((a) => {
    const next = { ...a }
    if (next[id] === v) delete next[id]
    else next[id] = v
    return next
  })

  const submit = async (intent: ResponseIntent, okMsg: string) => {
    setBusy(true)
    const availability = single && intent === 'joined' && !avail[slots[0]!.id] ? { [slots[0]!.id]: 'yes' as const } : avail
    await props.onSubmit({ intent, availability: intent === 'declined' ? {} : availability, optionIds, roles: gm ? ['gm'] : [], comment: comment.trim() }, okMsg)
    setBusy(false)
  }

  return (
    <Card className='mt12'>
      <View className='h2'>{prev ? '改一下' : '这局算你一个吗？'}</View>

      {!single && slots.length > 3 && (
        <View className='row wrap gap8 mt12'>
          <Chip small onClick={() => setAvail(Object.fromEntries(slots.map((x) => [x.id, 'yes' as const])))}>
            全都可以
          </Chip>
          <Chip small onClick={() => setAvail(Object.fromEntries(slots.filter((x) => isWeekendLocal(x.dateLabel)).map((x) => [x.id, 'yes' as const])))}>
            周末都行
          </Chip>
          <Chip small onClick={() => setAvail({})}>
            清空
          </Chip>
        </View>
      )}
      {!single && slots.length > 3 && (
        <View className='mt12'>
          <SlotCalendar
            slots={slots}
            badge={(ds) => {
              const yes = ds.some((x) => avail[x.id] === 'yes')
              const maybe = ds.some((x) => avail[x.id] === 'maybe')
              return { level: yes ? 1 : maybe ? 0.3 : 0, label: ds.length > 1 ? `${ds.length}场` : undefined }
            }}
            renderDay={(ds) =>
              ds.map((x) => (
                <View key={x.id} className='slot'>
                  <View className='bold'>
                    {x.dateLabel} {x.timeLabel}
                  </View>
                  {x.hostLine && <View className='muted'>发起人：{x.hostLine.replace(/^\S+时间 /, '')}</View>}
                  <View className='avail mt8'>
                    {(['yes', 'maybe', 'no'] as const).map((v) => (
                      <View key={v} className={cx('avail__btn', avail[x.id] === v && `avail__btn--${v}`)} onClick={() => setSlot(x.id, v)}>
                        {v === 'yes' ? '可以' : v === 'maybe' ? '看情况' : '不行'}
                      </View>
                    ))}
                  </View>
                </View>
              ))
            }
          />
        </View>
      )}
      {!single && slots.length <= 3 && (
        <View className='mt8'>
          {slots.map((s) => (
            <View key={s.id} className='slot'>
              <View className='bold'>{s.line}</View>
              <View className='muted'>
                {s.zoneLabel} {s.zoneAbbr}
                {s.hostLine ? ` · 发起人：${s.hostLine.replace(/^\S+时间 /, '')}` : ''}
              </View>
              <View className='avail mt8'>
                {(['yes', 'maybe', 'no'] as const).map((v) => (
                  <View key={v} className={cx('avail__btn', avail[s.id] === v && `avail__btn--${v}`)} onClick={() => setSlot(s.id, v)}>
                    {v === 'yes' ? '可以' : v === 'maybe' ? '看情况' : '不行'}
                  </View>
                ))}
              </View>
            </View>
          ))}
        </View>
      )}
      {single && slots[0] && (
        <View className='slot mt8'>
          <View className='bold'>{slots[0].line}</View>
          <View className='muted'>
            {slots[0].zoneLabel} {slots[0].zoneAbbr}
            {slots[0].hostLine ? ` · 发起人：${slots[0].hostLine.replace(/^\S+时间 /, '')}` : ''}
          </View>
        </View>
      )}

      {event.options.length > 1 && (
        <View className='mt12'>
          <View className='field__label'>想玩哪个？</View>
          <View className='row wrap gap8'>
            <Chip small on={optionIds.length === 0} onClick={() => setOptionIds([])}>
              都行
            </Chip>
            {event.options.map((o) => (
              <Chip
                key={o.id}
                small
                on={optionIds.includes(o.id)}
                onClick={() => setOptionIds(optionIds.includes(o.id) ? optionIds.filter((x) => x !== o.id) : [...optionIds, o.id])}
              >
                {o.emoji} {o.name}
              </Chip>
            ))}
          </View>
        </View>
      )}

      {needsGm && (
        <View className='switch-row mt8'>
          <Text>我能当 KP/GM</Text>
          <Switch color='#F2652D' checked={gm} onChange={(e) => setGm(e.detail.value)} />
        </View>
      )}

      {showComment || comment ? (
        <Input className='input mt12' placeholder='留句话，比如“可能晚到半小时”' maxlength={100} value={comment} onInput={(e) => setComment(e.detail.value)} />
      ) : (
        <View className='mt12'>
          <Text className='link small' onClick={() => setShowComment(true)}>
            ＋ 留句话
          </Text>
        </View>
      )}

      <View className='row gap8 mt16'>
        <Button kind='primary' size='lg' className='flex1' disabled={!anyYes} loading={busy} onClick={() => submit('joined', '算上你了！人齐会叫你')}>
          算我一个
        </Button>
        <Button size='lg' disabled={busy} onClick={() => submit('maybe', '好，先记你“看情况”')}>
          看情况
        </Button>
      </View>
      <View className='row row--between mt12'>
        <Text className='link small' onClick={() => !busy && submit('interested', '收到，组局的人会知道你想玩')}>
          时间都不行
        </Text>
        <Text className='muted' onClick={() => !busy && submit('declined', '收到，下次一定（真的）')}>
          这次就不了
        </Text>
      </View>
      {props.onCancel && (
        <View className='center mt12'>
          <Text className='link small' onClick={props.onCancel}>
            不改了
          </Text>
        </View>
      )}
    </Card>
  )
}

// ---------------- 参与者 ----------------

function ParticipantRow({ p, view }: { p: ParticipantView; view: EventView }) {
  const isHostViewer = view.viewer.role === 'host'
  const isHostRow = p.user.id === view.host.id
  const isMe = p.user.id === view.viewer.response?.userId
  const optionNames = p.optionIds.map((id) => view.event.options.find((o) => o.id === id)?.name).filter(Boolean)
  return (
    <View className='list-item'>
      <Avatar user={p.user} />
      <View className='flex1'>
        <View className='row gap8 wrap'>
          <Text className='bold'>{p.user.nickname}</Text>
          {isHostRow && <Text className='muted'>组局</Text>}
          {p.roles.includes('gm') && <Tag tone='info'>可当 KP</Tag>}
        </View>
        <View className='muted'>
          {optionNames.length > 0 ? `只想玩 ${optionNames.join('/')}` : ''}
          {p.comment ? `${optionNames.length ? ' · ' : ''}“${p.comment}”` : ''}
        </View>
      </View>
      <View className='col gap4' style={{ alignItems: 'flex-end' }}>
        <Tag tone={p.intent === 'joined' ? 'ok' : p.intent === 'maybe' ? 'warn' : 'info'}>{p.intent === 'joined' ? '来' : p.intent === 'maybe' ? '看情况' : '想玩'}</Tag>
        {isHostViewer && !isHostRow && !isMe && (
          <Text
            className='link small'
            onClick={async () => {
              try {
                const r = await post<{ status: string }>('/api/friends', { handle: p.user.handle })
                toast(r.status === 'accepted' ? '你们已经是好友' : '已发送好友请求')
              } catch (e) {
                toastError(e)
              }
            }}
          >
            加好友
          </Text>
        )}
      </View>
    </View>
  )
}

// ---------------- 发起人面板 ----------------

function HostPanel(props: {
  view: EventView
  onConfirm: (combo: ComboEvaluation) => void
  onPromote: (userId: string) => void
  onReopen: () => void
  onCancel: () => void
  onAddSlots: () => void
  onInvite: () => void
  onEmail: () => void
  onShare: () => void
}) {
  const { event, evaluation, hostOnly, rosterCheck } = props.view
  const nameOf = new Map(props.view.participants.map((p) => [p.user.id, p.user.nickname]))
  // 只列可以开局的组合（人还没齐时，上面的进度框已经说清楚了）
  const combos = (evaluation?.combos ?? []).filter((c) => c.feasible).slice(0, 4)
  const invitees = hostOnly?.invitees ?? []
  const live = event.status === 'open' || event.status === 'confirmed'
  const hasTop = (event.status === 'open' && combos.length > 0) || (event.status === 'confirmed' && !!rosterCheck && !rosterCheck.ok)

  return (
    <>
      <SectionTitle title='组局人' extra={<Text className='sub small'>只有你看得到</Text>} />
      <Card>
        {event.status === 'open' && (
          <>
            {combos.map((c) => {
              const o = event.options.find((x) => x.id === c.optionId)!
              const s = event.slots.find((x) => x.id === c.slotId)!
              return (
                <View key={`${c.optionId}-${c.slotId}`} className={cx('combo', c.feasible && 'combo--ok')}>
                  <View className='row row--between'>
                    <View className='flex1'>
                      <View className='bold'>
                        {o.emoji} {o.name} · {s.line}
                      </View>
                      <View className={cx('small', c.feasible ? 'ok-text' : 'sub')}>
                        {c.eligibleIds.length} 人可以 · {describeProgress(c)}
                        {c.waitlist.length > 0 ? ` · ${c.waitlist.length} 人候补` : ''}
                      </View>
                    </View>
                    {c.feasible && (
                      <Button kind='ok' size='sm' onClick={() => props.onConfirm(c)}>
                        就这么定了
                      </Button>
                    )}
                  </View>
                </View>
              )
            })}
          </>
        )}

        {event.status === 'confirmed' && event.final && (
          <>
            {rosterCheck && !rosterCheck.ok && event.final.waitlistIds.length > 0 && (
              <View className='mb8'>
                <View className='field__label'>从候补里叫人</View>
                {event.final.waitlistIds.map((id) => (
                  <View key={id} className='row row--between slot'>
                    <Text>{nameOf.get(id) ?? '?'}</Text>
                    <Button kind='ok' size='sm' onClick={() => props.onPromote(id)}>
                      叫 TA 补上
                    </Button>
                  </View>
                ))}
              </View>
            )}
            {rosterCheck && !rosterCheck.ok && event.final.waitlistIds.length === 0 && (
              <View className='sub'>候补里没人了：再叫几个人，或者重新开放换个时间。</View>
            )}
          </>
        )}

        {hasTop && <View className='divider' />}
        <View className='sub'>
          {invitees.length === 0 ? '没有单独叫人，空间成员可凭链接报名' : `单独叫了 ${invitees.length} 人，${invitees.filter((i) => i.responded).length} 人回了话`}
          {hostOnly && hostOnly.declinedCount > 0 ? `，${hostOnly.declinedCount} 人这次来不了` : ''}
        </View>
        {invitees.length > 0 && (
          <View className='mt8'>
            <AvatarStack users={invitees.map((i) => i.user)} max={10} />
          </View>
        )}
        <View className='row row--between mt16'>
          {live && (
            <View className='tool' onClick={props.onShare}>
              <View className='icon-btn'>
                <Icon name='share' />
              </View>
              <Text>分享</Text>
            </View>
          )}
          {live && (
            <View className='tool' onClick={props.onInvite}>
              <View className='icon-btn'>
                <Icon name='userPlus' />
              </View>
              <Text>再叫人</Text>
            </View>
          )}
          {live && (
            <View className='tool' onClick={props.onEmail}>
              <View className='icon-btn'>
                <Icon name='mail' />
              </View>
              <Text>发邮件</Text>
            </View>
          )}
          {(event.status === 'open' || event.status === 'expired') && (
            <View className='tool' onClick={props.onAddSlots}>
              <View className='icon-btn'>
                <Icon name='clock' />
              </View>
              <Text>加时间</Text>
            </View>
          )}
          {(live || event.status === 'expired') && (
            <View
              className='tool'
              onClick={async () => {
                const items = event.status === 'confirmed' ? ['重新开放报名', '取消这局'] : ['取消这局']
                const r = await Taro.showActionSheet({ itemList: items }).catch(() => null)
                if (!r) return
                if (items[r.tapIndex] === '重新开放报名') props.onReopen()
                else props.onCancel()
              }}
            >
              <View className='icon-btn'>
                <Icon name='more' />
              </View>
              <Text>更多</Text>
            </View>
          )}
        </View>
      </Card>
    </>
  )
}

// ---------------- 弹层 ----------------

function ShareSheet(props: { open: boolean; onClose: () => void; view: EventView; created: boolean }) {
  const { event, host } = props.view
  const url = appUrl(eventPath(event.code))
  const first = event.slots.find((s) => !s.isPast)
  const games = event.options.map((o) => `${o.emoji}${o.name}`).join(' / ')
  const text = `【${APP_NAME}】${host.nickname} 约你：${event.title}\n${games}${first ? ` · ${first.line}${first.zoneAbbr ? ` ${first.zoneAbbr}` : ''}${event.slots.length > 1 ? ` 等 ${event.slots.length} 个时间` : ''}` : ''}\n有空就来，没空不用回 👉`
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.created ? '局开好了，丢到群里吧' : '叫上朋友'}>
      <View className='sub mt4'>已加入本空间的朋友登录后即可报名，时间会自动换成他们那边的。</View>
      <View className='share-text mt12'>
        {text}
        {'\n'}
        {url}
      </View>
      {isH5 ? (
        <View className='row gap8 mt16'>
          <Button kind='primary' className='flex1' onClick={() => void copyText(`${text}\n${url}`, '复制好了，去群里粘贴吧')}>
            复制这段话
          </Button>
          <Button kind='outline' onClick={() => void shareText(event.title, text, url)}>更多</Button>
        </View>
      ) : (
        <TaroButton className='btn btn--primary btn--block mt16' openType='share'>
          发给微信好友 / 群
        </TaroButton>
      )}
      <View className='center mt12'>
        <Text className='link small' onClick={props.onClose}>
          先这样
        </Text>
      </View>
    </Sheet>
  )
}

function AddSlotsSheet(props: { open: boolean; tz: string; onClose: () => void; onSave: (slots: SlotInput[]) => void }) {
  const [slots, setSlots] = useState<SlotInput[]>([])
  return (
    <Sheet open={props.open} onClose={props.onClose} title='加几个时间'>
      <View className='mt12'>
        <SlotEditor tz={props.tz} durationMin={120} value={slots} onChange={setSlots} />
      </View>
      <Button kind='primary' block className='mt16' disabled={slots.length === 0} onClick={() => props.onSave(slots)}>
        添加 {slots.length || ''} 个时间
      </Button>
    </Sheet>
  )
}

function InviteSheet(props: { open: boolean; invitedIds: string[]; onClose: () => void; onSend: (userIds: string[], circleIds: string[]) => void }) {
  const [friends, setFriends] = useState<FriendsResponse['friends']>([])
  const [circles, setCircles] = useState<CirclesResponse['circles']>([])
  const [ids, setIds] = useState<string[]>([])
  const [circleIds, setCircleIds] = useState<string[]>([])
  useEffect(() => {
    if (!props.open) return
    setIds([])
    setCircleIds([])
    Promise.all([get<FriendsResponse>('/api/friends'), get<CirclesResponse>('/api/circles')])
      .then(([f, c]) => {
        setFriends(f.friends)
        setCircles(c.circles)
      })
      .catch(toastError)
  }, [props.open])
  const candidates = useMemo(() => friends.filter((f) => !props.invitedIds.includes(f.user.id)), [friends, props.invitedIds])
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  return (
    <Sheet open={props.open} onClose={props.onClose} title='再叫几个人'>
      <View className='sub mt4'>新邀请的人会收到一条通知，之前邀请过的人不会被重复打扰。</View>
      {circles.length > 0 && (
        <View className='row wrap gap8 mt12'>
          {circles.map((c) => (
            <Chip key={c.id} small on={circleIds.includes(c.id)} onClick={() => setCircleIds(toggle(circleIds, c.id))}>
              🫂 {c.name}
            </Chip>
          ))}
        </View>
      )}
      <View className='row wrap gap8 mt12'>
        {candidates.length === 0 && <Text className='muted'>好友都已经邀请过了</Text>}
        {candidates.map((f) => (
          <Chip key={f.user.id} small on={ids.includes(f.user.id)} onClick={() => setIds(toggle(ids, f.user.id))}>
            {f.user.avatar} {f.user.nickname}
          </Chip>
        ))}
      </View>
      <Button kind='primary' block className='mt16' disabled={ids.length + circleIds.length === 0} onClick={() => props.onSend(ids, circleIds)}>
        叫他们
      </Button>
    </Sheet>
  )
}
