import { t, useLocale, getLocale, useLocaleDidShow, localizeBuiltinGame } from '../../lib/i18n'
import { Button as TaroButton, Input, Switch, Text, Textarea, View } from '@tarojs/components'
import Taro, { useRouter, useShareAppMessage } from '@tarojs/taro'
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
import { ApiError, get, patch, post, put } from '../../lib/api'
import { bootSession, requireUser, useSession } from '../../lib/session'
import { isWeekendLocalDate } from '../../lib/localeCalendar'
import { APP_NAME } from '../../lib/brand'
import { appUrl, confirm, copyText, eventPath, go, isH5, shareText, toast, toastError, toastOk } from '../../lib/ui'

type ActionResult = { view: EventView; added?: number }

export default function EventDetail() {
  useLocale()
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
  const [editSheet, setEditSheet] = useState(false)

  const load = async () => {
    await bootSession()
    try {
      const v = await get<EventView>(`/api/events/${code}?tz=${encodeURIComponent(DEFAULT_TIMEZONE)}`)
      setView(v)
      setError(null)
      if (isH5) void Taro.setNavigationBarTitle({ title: v.event.title })
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_context') return
      setError(e instanceof ApiError ? e.message : t('加载失败'))
    }
  }
  useLocaleDidShow(() => {
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

  const shareTitle = view ? t('{0} 约你：{1}', view.host.nickname, view.event.title) : APP_NAME
  useShareAppMessage(() => ({ title: shareTitle, path: eventPath(code) }))

  /** 发起人/报名者的操作：成功后用服务端返回的最新视图刷新 */
  const act = async (path: string, body?: unknown, okMsg?: string, method: 'post' | 'put' | 'patch' = 'post') => {
    try {
      const res =
        method === 'put' ? await put<ActionResult>(path, body) : method === 'patch' ? await patch<ActionResult>(path, body) : await post<ActionResult>(path, body)
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
            {t('回首页')}
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
    view.participants.filter(
      (p) =>
        (p.intent === 'joined' || p.intent === 'maybe') &&
        (p.availability[slotId] === 'maybe' || (p.intent === 'maybe' && p.availability[slotId] === 'yes')),
    )
  const feasibleSlots = new Set((view.evaluation?.combos ?? []).filter((c) => c.feasible).map((c) => c.slotId))
  const need = Math.max(1, Math.min(...event.options.map((o) => o.minPlayers)))
  const bestDate = [...futureSlots].sort((a, b) => yesOf(b.id).length - yesOf(a.id).length || a.startUtc.localeCompare(b.startUtc))[0]
    ?.localDate
  const showEditor = viewer.canRespond && !viewer.inRoster && (editing || !myResp) && !(isHost && myResp)

  return (
    <Page
      footer={
        isHost && event.status === 'open' ? (
          <Button kind='primary' block size='lg' onClick={() => setShareOpen(true)}>
            {t('丢到群里')}
          </Button>
        ) : undefined
      }
    >
      {/* 头部 */}
      <View className='row row--between'>
        <Icon name='left' onClick={() => void Taro.redirectTo({ url: '/pages/index/index' })} />
        {!view.restricted && (event.status === 'open' || event.status === 'confirmed') && (
          <Icon name='share' onClick={() => setShareOpen(true)} />
        )}
      </View>
      <View className='mt12'>
        <View className='row gap8'>
          <Text className='emoji-lg'>{event.options.map((o) => o.emoji).join('')}</Text>
          <Tag tone={event.status === 'confirmed' ? 'ok' : event.status === 'open' ? 'brand' : 'gray'}>{event.statusText}</Tag>
          {event.mode === 'offline' && <Tag tone='info'>{t('线下')}</Tag>}
        </View>
        <View className='h1 mt8'>{event.title}</View>
        <View className='row gap8 mt8'>
          <Avatar user={view.host} size='sm' />
          <Text className='sub'>{t('{0} 组的局', isHost ? t('我') : view.host.nickname)}</Text>
          {event.options.length > 1 && <Text className='muted'>{t('· {0} 种玩法，大家挑', event.options.length)}</Text>}
        </View>
        {event.note && <View className='sub mt8'>{event.note}</View>}
        {event.location && <View className='sub mt4'>📍 {event.location}</View>}
        {!view.restricted && <WhoIsIn view={view} />}
      </View>

      {view.restricted ? (
        <Card tone='warn' className='mt16'>
          <View className='h3'>{t('🔒 这局只对被邀请的人开放')}</View>
          <View className='sub mt4'>
            {t('如果你也想参加，可以先加 {0} 为好友（ID：{1}），请 TA 邀请你。', view.host.nickname, view.host.handle)}
          </View>
          <Button kind='primary' size='sm' className='mt12' onClick={() => go(`/pages/friends/add?h=${view.host.handle}`)}>
            {t('加{0}为好友', view.host.nickname)}
          </Button>
        </Card>
      ) : (
        <>
          <StatusBanner view={view} />

          {/* 我的状态 / 报名 */}
          {viewer.inRoster && event.status === 'confirmed' && (
            <RosterCard
              view={view}
              onConfirm={() => act(`/api/events/${code}/final-confirm`, {}, t('好，到时见'))}
              onWithdraw={async () => {
                if (await confirm(t('临时有事？'), t('会告诉组局的人找人补上。没事，下次再约。'), t('嗯，来不了'))) {
                  await act(`/api/events/${code}/withdraw`, {}, t('已经告诉组局的人了'))
                }
              }}
            />
          )}
          {viewer.inWaitlist && (
            <Card tone='info' className='mt12'>
              <View className='bold'>{t('你在候补第 {0} 位', (event.final?.waitlistIds.indexOf(user?.id ?? '') ?? 0) + 1)}</View>
              <View className='sub mt4'>{t('有人临时有事，组局的人会叫你补上，到时会通知你。')}</View>
              <Text
                className='link small mt8'
                onClick={async () => {
                  if (await confirm(t('不排候补了？'), t('之后改主意还能再报名。'), t('不排了')))
                    await act(`/api/events/${code}/withdraw`, {}, t('已退出候补'))
                }}
              >
                {t('不排了')}
              </Text>
            </Card>
          )}
          {!showEditor && myResp && !viewer.inRoster && !viewer.inWaitlist && !isHost && (
            <MyResponse
              view={view}
              onEdit={() => setEditing(true)}
              onWithdraw={async () => {
                if (await confirm(t('退出这局？'), t('组局的人会看到你不来了，之后改主意还能再报名。'), t('确定退出')))
                  await act(`/api/events/${code}/withdraw`, {}, t('已退出这局'))
              }}
            />
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
          {!viewer.canRespond && !myResp && event.status !== 'open' && !isHost && (
            <View className='muted center mt16'>{t('这局现在不收人了')}</View>
          )}

          {/* 发起人面板 */}
          {isHost && (
            <HostPanel
              view={view}
              onConfirm={async (combo) => {
                const option = optionById.get(combo.optionId)!
                const slot = slotById.get(combo.slotId)!
                const names = (ids: string[]) => ids.map((id) => nameOf.get(id)?.nickname ?? '?').join('、')
                const ok = await confirm(
                  t('就这么定了？'),
                  t(
                    '{0} {1} · {2}。名单：{3}{4}。定了之后会通知名单里的人。',
                    option.emoji,
                    option.name,
                    slot.line,
                    names(combo.roster),
                    combo.waitlist.length ? t('；候补：{0}', names(combo.waitlist)) : '',
                  ),
                  t('定了'),
                )
                if (ok) await act(`/api/events/${code}/confirm`, { optionId: combo.optionId, slotId: combo.slotId }, t('成了！'))
              }}
              onPromote={(userId) => act(`/api/events/${code}/promote`, { userId }, t('已经叫 TA 补上'))}
              onReopen={async () => {
                if (await confirm(t('重新开放报名？'), t('当前名单会清空，大家的报名保留。')))
                  await act(`/api/events/${code}/reopen`, {}, t('已重新开放'))
              }}
              onCancel={async () => {
                if (await confirm(t('取消这局？'), t('会告诉已经报名的朋友。'), t('取消这局')))
                  await act(`/api/events/${code}/cancel`, { reason: '' }, t('已取消'))
              }}
              onAddSlots={() => setSlotSheet(true)}
              onInvite={() => setInviteSheet(true)}
              onEmail={() => setEmailSheet(true)}
              onShare={() => setShareOpen(true)}
              onEdit={() => setEditSheet(true)}
            />
          )}

          {/* 大家的时间：日历视图，颜色越深能来的人越多 */}
          {futureSlots.length > 0 && view.participants.length > 0 && event.status === 'open' && (
            <>
              <SectionTitle title={t('大家的时间')} extra={<Text className='sub small'>{t('颜色越深，能来的人越多')}</Text>} />
              <Card>
                <SlotCalendar
                  slots={futureSlots}
                  initialDate={bestDate}
                  badge={(ds) => {
                    const top = Math.max(...ds.map((x) => yesOf(x.id).length))
                    return {
                      level: top / need,
                      label: top > 0 ? t('{0}人', top) : undefined,
                      mark: ds.some((x) => feasibleSlots.has(x.id)),
                    }
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
                            {feasibleSlots.has(x.id) ? (
                              <Tag tone='ok'>{t('人齐')}</Tag>
                            ) : (
                              <Text className='sub'>{t('{0} 人可以', yes.length)}</Text>
                            )}
                          </View>
                          {(yes.length > 0 || maybe.length > 0) && (
                            <View className='row gap8 mt8'>
                              <AvatarStack users={yes.map((p) => p.user)} max={8} />
                              {maybe.length > 0 && <Text className='muted'>{t('另有 {0} 人看情况', maybe.length)}</Text>}
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
          <SectionTitle title={t('谁来（{0}）', view.participants.filter((p) => p.intent === 'joined').length)} />
          <Card>
            {view.participants.length === 0 ? (
              <Empty icon='👋' text={t('还没人回话。丢到群里试试？')} />
            ) : (
              view.participants.map((p) => <ParticipantRow key={p.user.id} p={p} view={view} />)
            )}
            {isHost && view.hostOnly && view.hostOnly.declinedCount > 0 && (
              <View className='muted mt8'>{t('另有 {0} 人这次来不了（不告诉你是谁）', view.hostOnly.declinedCount)}</View>
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
            const res = await act(`/api/events/${code}/slots`, { slots }, t('已添加时间'))
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
              toast(res.added ? t('已邀请 {0} 人', res.added) : t('他们都已经在邀请名单里了'))
              setInviteSheet(false)
            }
          }}
        />
      )}
      {isHost && <EmailInviteSheet open={emailSheet} code={code} onClose={() => setEmailSheet(false)} />}
      {isHost && (
        <EditEventSheet
          open={editSheet}
          view={view}
          onClose={() => setEditSheet(false)}
          onSave={async (body) => {
            if (await act(`/api/events/${code}`, body, t('改好了'), 'patch')) setEditSheet(false)
          }}
        />
      )}
    </Page>
  )
}

/** 用邮件叫还没用 App 的朋友 */
function EmailInviteSheet(props: { open: boolean; code: string; onClose: () => void }) {
  useLocale()
  const [text, setText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const emails = [
    ...new Set(
      text
        .split(/[\s,，;；]+/)
        .map((x) => x.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
  const REASON: Record<string, string> = { unsubscribed: t('对方退订过'), duplicate: t('24 小时内发过了'), rate_limited: t('今天发太多了') }
  const send = async () => {
    setBusy(true)
    try {
      const r = await post<EmailInviteResponse>(`/api/events/${props.code}/email-invite`, { emails, message })
      const skipped = r.skipped.map((s) => `${s.email}（${REASON[s.reason]}）`).join('、')
      toast(t('{0}发出 {1} 封{2}', r.transport === 'console' ? t('演示模式：') : '', r.sent, skipped ? t('；跳过 {0}', skipped) : ''))
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
    <Sheet open={props.open} onClose={props.onClose} title={t('用邮件叫人')}>
      <View className='sub mt4'>{t('仅能发给本空间已验证邮箱的成员。新人请先用空间邀请链接申请加入，每封邮件都带退订链接。')}</View>
      <Textarea
        className='textarea mt12'
        placeholder={t('朋友的邮箱，多个用空格或逗号隔开')}
        maxlength={600}
        value={text}
        onInput={(e) => setText(e.detail.value)}
      />
      <Input
        className='input mt8'
        placeholder={t('附一句话（可选），比如“缺一个，来吗”')}
        maxlength={100}
        value={message}
        onInput={(e) => setMessage(e.detail.value)}
      />
      <View className='muted mt8'>{t('时间按北京时间写，并附上你那边的时间。夜里不发，攒到早上 8:30。')}</View>
      <Button kind='primary' block className='mt16' loading={busy} disabled={emails.length === 0} onClick={send}>
        {emails.length ? t('发给 {0} 个人', emails.length) : t('发邀请')}
      </Button>
    </Sheet>
  )
}

// ---------------- 状态横幅 ----------------

function StatusBanner({ view }: { view: EventView }) {
  useLocale()
  const { event, evaluation } = view
  const isHost = view.viewer.role === 'host'
  const option = (id: string) => event.options.find((o) => o.id === id)
  const slot = (id: string) => event.slots.find((s) => s.id === id)

  if (event.status === 'cancelled') {
    return (
      <Card className='mt16'>
        <View className='h3'>{t('这局取消了')}</View>
        <View className='sub mt4'>{event.cancelReason || t('下次再约～')}</View>
      </Card>
    )
  }
  if (event.status === 'expired') {
    return (
      <Card className='mt16'>
        <View className='h3'>{t('时间都过了，没凑成')}</View>
        <View className='sub mt4'>{isHost ? t('加几个新时间，再试一次？') : t('这次没凑成，下次再约～')}</View>
      </Card>
    )
  }
  if ((event.status === 'confirmed' || event.status === 'completed') && event.final) {
    const o = option(event.final.optionId)
    const s = slot(event.final.slotId)
    const check = view.rosterCheck
    return (
      <Card tone={check && !check.ok ? 'warn' : 'ok'} className='mt16'>
        <View className='h2'>
          {event.status === 'completed'
            ? t('这局结束了')
            : check && !check.ok
              ? t('有人临时有事，还差 {0} 个', check.stillNeed)
              : t('成了！🎉')}
        </View>
        <View className='bold mt8'>
          {o?.emoji} {o ? localizeBuiltinGame(o).name : ''} · {s?.line}
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
        <View className='sub'>{t('没有能选的时间了{0}', isHost ? t('，加几个新时间吧') : '')}</View>
      </Card>
    )
  }
  const best = evaluation.best
  const o = option(best.optionId)!
  const s = slot(best.slotId)!
  return (
    <Card tone={best.feasible ? 'ok' : 'brand'} className='mt16'>
      <View className='row row--between'>
        <Text className='eyebrow'>{best.feasible ? t('人齐了') : t('眼下最有戏')}</Text>
        <Text className='small bold'>
          {t('{0}/{1}人', best.eligibleIds.length, o.minPlayers === o.maxPlayers ? o.minPlayers : `${o.minPlayers}–${o.maxPlayers}`)}
        </Text>
      </View>
      <View className='h3 mt4'>
        {o.emoji} {localizeBuiltinGame(o).name} · {s.line}
      </View>
      {s.hostLine && <View className='muted'>{s.hostLine}</View>}
      <View className='mt8'>
        <Progress value={best.eligibleIds.length} total={o.minPlayers} ok={best.feasible} />
      </View>
      <View className={cx('small mt8', best.feasible ? 'ok-text bold' : 'sub')}>
        {best.feasible
          ? isHost
            ? t('人够了，在下面点“就这么定了”')
            : t('人够了，等 {0} 拍板', view.host.nickname)
          : describeProgress(best, getLocale())}
        {best.maybeIds.length > 0 && !best.feasible ? t('，还有 {0} 人在看情况', best.maybeIds.length) : ''}
      </View>
    </Card>
  )
}

function RosterList({ view }: { view: EventView }) {
  useLocale()
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
              {id === view.host.id ? <Text className='muted'>{t('（组局）')}</Text> : null}
            </Text>
            {roleOf(id) && <Tag tone='info'>KP/GM</Tag>}
            {p.finalConfirmed ? <Tag tone='ok'>{t('会来')}</Tag> : <Text className='muted'>{t('还没点头')}</Text>}
          </View>
        )
      })}
      {final.waitlistIds.length > 0 && (
        <View className='muted mt8'>{t('候补：{0}', final.waitlistIds.map((id) => byId.get(id)?.user.nickname ?? '?').join('、'))}</View>
      )}
    </View>
  )
}

// ---------------- 名单成员 ----------------

function RosterCard(props: { view: EventView; onConfirm: () => void; onWithdraw: () => void }) {
  useLocale()
  const r = props.view.viewer.response
  if (r?.finalConfirmed) {
    return (
      <Card className='mt12'>
        <View className='row row--between'>
          <Text className='bold ok-text'>{t('✓ 你说了会来')}</Text>
          {props.view.viewer.role !== 'host' && (
            <Text className='link small' onClick={props.onWithdraw}>
              {t('临时有事')}
            </Text>
          )}
        </View>
      </Card>
    )
  }
  return (
    <Card className='mt12'>
      <View className='h3'>{t('定了！就等你点个头')}</View>
      <View className='sub mt4'>{t('点一下，大家就知道你会来。')}</View>
      <Button kind='ok' block size='lg' className='mt12' onClick={props.onConfirm}>
        {t('我会来')}
      </Button>
      <View className='center mt8'>
        <Text className='link small' onClick={props.onWithdraw}>
          {t('临时有事，来不了')}
        </Text>
      </View>
    </Card>
  )
}

/** 报名后温和提示：留个邮箱，成团时能收到邮件（已留过就不显示） */
function EmailHint() {
  useLocale()
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
      <Text className='link small'>{t('留个邮箱，成团时告诉你')}</Text>
    </View>
  )
}

const INTENT_TEXT: Record<ResponseIntent, string> = {
  joined: '✅ 算上你了',
  maybe: '🤔 你说看情况',
  interested: '🙋 你想玩，但时间不太行',
  declined: '这次就不了，没关系',
}

function MyResponse(props: { view: EventView; onEdit: () => void; onWithdraw: () => void }) {
  useLocale()
  const r = props.view.viewer.response!
  const yesSlots = props.view.event.slots.filter((s) => r.availability[s.id] === 'yes')
  return (
    <Card className='mt12'>
      <View className='row row--between'>
        <Text className={cx('bold', r.intent === 'joined' && 'ok-text')}>{t(INTENT_TEXT[r.intent])}</Text>
        {props.view.viewer.canRespond && (
          <Text className='link' onClick={props.onEdit}>
            {r.intent === 'declined' ? t('改主意了') : t('改一下')}
          </Text>
        )}
      </View>
      {r.intent === 'joined' && <View className='sub mt4'>{t('可以的时间：{0}', yesSlots.map((s) => s.line).join('；'))}</View>}
      {r.intent === 'joined' && <EmailHint />}
      {r.intent !== 'declined' && (props.view.event.status === 'open' || props.view.event.status === 'confirmed') && (
        <View className='mt8'>
          <Text className='muted small' onClick={props.onWithdraw}>
            {t('退出这局')}
          </Text>
        </View>
      )}
    </Card>
  )
}

// ---------------- 报名面板 ----------------

function RespondPanel(props: {
  view: EventView
  onSubmit: (
    body: { intent: ResponseIntent; availability: Record<string, SlotAvailability>; optionIds: string[]; roles: string[]; comment: string },
    okMsg: string,
  ) => Promise<void>
  onCancel?: () => void
}) {
  useLocale()
  const { event, viewer } = props.view
  const prev = viewer.response
  const slots = event.slots.filter((s) => !s.isPast)
  const [avail, setAvail] = useState<Record<string, SlotAvailability>>(() =>
    prev?.intent === 'declined' ? {} : (prev?.availability ?? {}),
  )
  const [optionIds, setOptionIds] = useState<string[]>(prev?.optionIds ?? [])
  const [gm, setGm] = useState(prev?.roles.includes('gm') ?? false)
  const [comment, setComment] = useState(prev?.comment ?? '')
  const [busy, setBusy] = useState(false)
  const [showComment, setShowComment] = useState(false)
  const needsGm = event.options.some((o) => o.roles.some((r) => r.key === 'gm'))
  const single = slots.length === 1
  const anyYes = Object.values(avail).includes('yes') || single

  const setSlot = (id: string, v: SlotAvailability) =>
    setAvail((a) => {
      const next = { ...a }
      if (next[id] === v) delete next[id]
      else next[id] = v
      return next
    })

  const submit = async (intent: ResponseIntent, okMsg: string) => {
    setBusy(true)
    const availability = single && intent === 'joined' && !avail[slots[0]!.id] ? { [slots[0]!.id]: 'yes' as const } : avail
    await props.onSubmit(
      { intent, availability: intent === 'declined' ? {} : availability, optionIds, roles: gm ? ['gm'] : [], comment: comment.trim() },
      okMsg,
    )
    setBusy(false)
  }

  return (
    <Card className='mt12'>
      <View className='h2'>{prev ? t('改一下') : t('这局算你一个吗？')}</View>

      {!single && slots.length > 3 && (
        <View className='row wrap gap8 mt12'>
          <Chip small onClick={() => setAvail(Object.fromEntries(slots.map((x) => [x.id, 'yes' as const])))}>
            {t('全都可以')}
          </Chip>
          <Chip
            small
            onClick={() =>
              setAvail(Object.fromEntries(slots.filter((x) => isWeekendLocalDate(x.localDate)).map((x) => [x.id, 'yes' as const])))
            }
          >
            {t('周末都行')}
          </Chip>
          <Chip small onClick={() => setAvail({})}>
            {t('清空')}
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
              return { level: yes ? 1 : maybe ? 0.3 : 0, label: ds.length > 1 ? t('{0}场', ds.length) : undefined }
            }}
            renderDay={(ds) =>
              ds.map((x) => (
                <View key={x.id} className='slot'>
                  <View className='bold'>
                    {x.dateLabel} {x.timeLabel}
                  </View>
                  {x.hostLine && <View className='muted'>{t('发起人：{0}', x.hostLine.replace(/^\S+时间 /, ''))}</View>}
                  <View className='avail mt8'>
                    {(['yes', 'maybe', 'no'] as const).map((v) => (
                      <View key={v} className={cx('avail__btn', avail[x.id] === v && `avail__btn--${v}`)} onClick={() => setSlot(x.id, v)}>
                        {v === 'yes' ? t('可以') : v === 'maybe' ? t('看情况') : t('不行')}
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
                {s.hostLine ? t(' · 发起人：{0}', s.hostLine.replace(/^\S+时间 /, '')) : ''}
              </View>
              <View className='avail mt8'>
                {(['yes', 'maybe', 'no'] as const).map((v) => (
                  <View key={v} className={cx('avail__btn', avail[s.id] === v && `avail__btn--${v}`)} onClick={() => setSlot(s.id, v)}>
                    {v === 'yes' ? t('可以') : v === 'maybe' ? t('看情况') : t('不行')}
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
            {slots[0].hostLine ? t(' · 发起人：{0}', slots[0].hostLine.replace(/^\S+时间 /, '')) : ''}
          </View>
        </View>
      )}

      {event.options.length > 1 && (
        <View className='mt12'>
          <View className='field__label'>{t('想玩哪个？')}</View>
          <View className='row wrap gap8'>
            <Chip small on={optionIds.length === 0} onClick={() => setOptionIds([])}>
              {t('都行')}
            </Chip>
            {event.options.map((o) => (
              <Chip
                key={o.id}
                small
                on={optionIds.includes(o.id)}
                onClick={() => setOptionIds(optionIds.includes(o.id) ? optionIds.filter((x) => x !== o.id) : [...optionIds, o.id])}
              >
                {o.emoji} {localizeBuiltinGame(o).name}
              </Chip>
            ))}
          </View>
        </View>
      )}

      {needsGm && (
        <View className='switch-row mt8'>
          <Text>{t('我能当 KP/GM')}</Text>
          <Switch color='#FF2B2B' checked={gm} onChange={(e) => setGm(e.detail.value)} />
        </View>
      )}

      {showComment || comment ? (
        <Input
          className='input mt12'
          placeholder={t('留句话，比如“可能晚到半小时”')}
          maxlength={100}
          value={comment}
          onInput={(e) => setComment(e.detail.value)}
        />
      ) : (
        <View className='mt12'>
          <Text className='link small' onClick={() => setShowComment(true)}>
            {t('＋ 留句话')}
          </Text>
        </View>
      )}

      <View className='row gap8 mt16'>
        <Button
          kind='primary'
          size='lg'
          className='flex1'
          disabled={!anyYes}
          loading={busy}
          onClick={() => submit('joined', t('算上你了！人齐会叫你'))}
        >
          {t('算我一个')}
        </Button>
        <Button size='lg' disabled={busy} onClick={() => submit('maybe', t('好，先记你“看情况”'))}>
          {t('看情况')}
        </Button>
      </View>
      <View className='row row--between mt12'>
        <Text className='link small' onClick={() => !busy && submit('interested', t('收到，组局的人会知道你想玩'))}>
          {t('时间都不行')}
        </Text>
        <Text className='muted' onClick={() => !busy && submit('declined', t('收到，下次一定（真的）'))}>
          {t('这次就不了')}
        </Text>
      </View>
      {props.onCancel && (
        <View className='center mt12'>
          <Text className='link small' onClick={props.onCancel}>
            {t('不改了')}
          </Text>
        </View>
      )}
    </Card>
  )
}

// ---------------- 参与者 ----------------

function ParticipantRow({ p, view }: { p: ParticipantView; view: EventView }) {
  useLocale()
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
          {isHostRow && <Text className='muted'>{t('组局')}</Text>}
          {p.roles.includes('gm') && <Tag tone='info'>{t('可当 KP')}</Tag>}
        </View>
        <View className='muted'>
          {optionNames.length > 0 ? t('只想玩 {0}', optionNames.join('/')) : ''}
          {p.comment ? `${optionNames.length ? ' · ' : ''}“${p.comment}”` : ''}
        </View>
      </View>
      <View className='col gap4' style={{ alignItems: 'flex-end' }}>
        <Tag tone={p.intent === 'joined' ? 'ok' : p.intent === 'maybe' ? 'warn' : 'info'}>
          {p.intent === 'joined' ? t('来') : p.intent === 'maybe' ? t('看情况') : t('想玩')}
        </Tag>
        {isHostViewer && !isHostRow && !isMe && (
          <Text
            className='link small'
            onClick={async () => {
              try {
                const r = await post<{ status: string }>('/api/friends', { handle: p.user.handle })
                toast(r.status === 'accepted' ? t('你们已经是好友') : t('已发送好友请求'))
              } catch (e) {
                toastError(e)
              }
            }}
          >
            {t('加好友')}
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
  onEdit: () => void
}) {
  useLocale()
  const { event, evaluation, hostOnly, rosterCheck } = props.view
  const nameOf = new Map(props.view.participants.map((p) => [p.user.id, p.user.nickname]))
  // 只列可以开局的组合（人还没齐时，上面的进度框已经说清楚了）
  const combos = (evaluation?.combos ?? []).filter((c) => c.feasible).slice(0, 4)
  const invitees = hostOnly?.invitees ?? []
  const live = event.status === 'open' || event.status === 'confirmed'
  const hasTop = (event.status === 'open' && combos.length > 0) || (event.status === 'confirmed' && !!rosterCheck && !rosterCheck.ok)

  return (
    <>
      <SectionTitle title={t('组局人')} extra={<Text className='sub small'>{t('只有你看得到')}</Text>} />
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
                        {o.emoji} {localizeBuiltinGame(o).name} · {s.line}
                      </View>
                      <View className={cx('small', c.feasible ? 'ok-text' : 'sub')}>
                        {t(
                          '{0} 人可以 · {1}{2}',
                          c.eligibleIds.length,
                          describeProgress(c, getLocale()),
                          c.waitlist.length > 0 ? t(' · {0} 人候补', c.waitlist.length) : '',
                        )}
                      </View>
                    </View>
                    {c.feasible && (
                      <Button kind='ok' size='sm' onClick={() => props.onConfirm(c)}>
                        {t('就这么定了')}
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
                <View className='field__label'>{t('从候补里叫人')}</View>
                {event.final.waitlistIds.map((id) => (
                  <View key={id} className='row row--between slot'>
                    <Text>{nameOf.get(id) ?? '?'}</Text>
                    <Button kind='ok' size='sm' onClick={() => props.onPromote(id)}>
                      {t('叫 TA 补上')}
                    </Button>
                  </View>
                ))}
              </View>
            )}
            {rosterCheck && !rosterCheck.ok && event.final.waitlistIds.length === 0 && (
              <View className='sub'>{t('候补里没人了：再叫几个人，或者重新开放换个时间。')}</View>
            )}
          </>
        )}

        {hasTop && <View className='divider' />}
        <View className='sub'>
          {invitees.length === 0
            ? t('没有单独叫人，空间成员可凭链接报名')
            : t('单独叫了 {0} 人，{1} 人回了话', invitees.length, invitees.filter((i) => i.responded).length)}
          {hostOnly && hostOnly.declinedCount > 0 ? t('，{0} 人这次来不了', hostOnly.declinedCount) : ''}
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
              <Text>{t('分享')}</Text>
            </View>
          )}
          {live && (
            <View className='tool' onClick={props.onInvite}>
              <View className='icon-btn'>
                <Icon name='userPlus' />
              </View>
              <Text>{t('再叫人')}</Text>
            </View>
          )}
          {live && (
            <View className='tool' onClick={props.onEmail}>
              <View className='icon-btn'>
                <Icon name='mail' />
              </View>
              <Text>{t('发邮件')}</Text>
            </View>
          )}
          {live && (
            <View className='tool' onClick={props.onEdit}>
              <View className='icon-btn'>
                <Icon name='edit' />
              </View>
              <Text>{t('编辑')}</Text>
            </View>
          )}
          {(event.status === 'open' || event.status === 'expired') && (
            <View className='tool' onClick={props.onAddSlots}>
              <View className='icon-btn'>
                <Icon name='clock' />
              </View>
              <Text>{t('加时间')}</Text>
            </View>
          )}
          {(live || event.status === 'expired') && (
            <View
              className='tool'
              onClick={async () => {
                const items = event.status === 'confirmed' ? [t('重新开放报名'), t('取消这局')] : [t('取消这局')]
                const r = await Taro.showActionSheet({ itemList: items }).catch(() => null)
                if (!r) return
                if (items[r.tapIndex] === t('重新开放报名')) props.onReopen()
                else props.onCancel()
              }}
            >
              <View className='icon-btn'>
                <Icon name='more' />
              </View>
              <Text>{t('更多')}</Text>
            </View>
          )}
        </View>
      </Card>
    </>
  )
}

/** 标题下方一眼看到谁已经要来 */
function WhoIsIn({ view }: { view: EventView }) {
  useLocale()
  const joined = view.participants.filter((p) => p.intent === 'joined')
  const maybe = view.participants.filter((p) => p.intent === 'maybe').length
  if (joined.length === 0) {
    if (view.viewer.role === 'host' || view.event.status !== 'open') return null
    return <View className='sub mt12'>{t('还没人报名，你来当第一个？')}</View>
  }
  const sep = getLocale() === 'en' ? ', ' : '、'
  const names = joined.slice(0, 4).map((p) => p.user.nickname).join(sep) + (joined.length > 4 ? '…' : '')
  return (
    <View className='row gap8 mt12'>
      <AvatarStack users={joined.map((p) => p.user)} max={6} />
      <Text className='sub flex1'>
        {t('已经有 {0} 人要来：{1}', joined.length, names)}
        {maybe > 0 ? t('，{0} 人看情况', maybe) : ''}
      </Text>
    </View>
  )
}

// ---------------- 弹层 ----------------
function EditEventSheet(props: {
  open: boolean
  view: EventView
  onClose: () => void
  onSave: (body: { title: string; note: string; mode: 'online' | 'offline'; location: string; removeSlotIds: string[] }) => void
}) {
  useLocale()
  const { event } = props.view
  const [title, setTitle] = useState(event.title)
  const [note, setNote] = useState(event.note)
  const [offline, setOffline] = useState(event.mode === 'offline')
  const [location, setLocation] = useState(event.location)
  const [removed, setRemoved] = useState<string[]>([])
  useEffect(() => {
    // 每次打开都从当前内容开始
    if (!props.open) return
    setTitle(event.title)
    setNote(event.note)
    setOffline(event.mode === 'offline')
    setLocation(event.location)
    setRemoved([])
  }, [props.open])
  const canEditSlots = event.status === 'open'
  const left = event.slots.filter((s) => !removed.includes(s.id)).length
  return (
    <Sheet open={props.open} onClose={props.onClose} title={t('编辑这局')}>
      <View className='field__label mt12'>{t('标题')}</View>
      <Input className='input' maxlength={40} value={title} onInput={(e) => setTitle(e.detail.value)} />
      <Textarea
        className='textarea mt8'
        placeholder={t('备注，比如：雀魂友人场')}
        maxlength={300}
        value={note}
        onInput={(e) => setNote(e.detail.value)}
      />
      <View className='switch-row mt8'>
        <Text>{t('线下见面')}</Text>
        <Switch color='#FF2B2B' checked={offline} onChange={(e) => setOffline(e.detail.value)} />
      </View>
      {offline && (
        <Input
          className='input'
          placeholder={t('地点（可以之后再定）')}
          maxlength={80}
          value={location}
          onInput={(e) => setLocation(e.detail.value)}
        />
      )}
      {canEditSlots ? (
        <>
          <View className='field__label mt12'>{t('候选时间（点 × 删掉，加时间用“加时间”）')}</View>
          {event.slots.map((s) => {
            const gone = removed.includes(s.id)
            return (
              <View key={s.id} className='row row--between mt8'>
                <Text className={cx(gone ? 'muted' : 'sub')} style={gone ? { textDecoration: 'line-through' } : undefined}>
                  {s.line}
                </Text>
                {gone ? (
                  <Text className='link small' onClick={() => setRemoved(removed.filter((x) => x !== s.id))}>
                    {t('撤销')}
                  </Text>
                ) : (
                  <Icon name='x' onClick={() => left > 1 && setRemoved([...removed, s.id])} />
                )}
              </View>
            )
          })}
        </>
      ) : (
        <View className='muted mt12'>{t('成团后时间就定了；要改时间，先重新开放报名')}</View>
      )}
      <View className='muted mt12'>{t('改了地点或时间，会通知已经报名的人。')}</View>
      <Button
        kind='primary'
        block
        className='mt16'
        disabled={!title.trim()}
        onClick={() =>
          props.onSave({
            title: title.trim(),
            note: note.trim(),
            mode: offline ? 'offline' : 'online',
            location: offline ? location.trim() : '',
            removeSlotIds: removed,
          })
        }
      >
        {t('保存')}
      </Button>
    </Sheet>
  )
}


function ShareSheet(props: { open: boolean; onClose: () => void; view: EventView; created: boolean }) {
  useLocale()
  const { event, host } = props.view
  const url = appUrl(eventPath(event.code))
  const first = event.slots.find((s) => !s.isPast)
  const games = event.options.map((o) => `${o.emoji}${localizeBuiltinGame(o).name}`).join(' / ')
  const text = t(
    '【{0}】{1} 约你：{2}\n{3}{4}\n有空就来，没空不用回 👉',
    APP_NAME,
    host.nickname,
    event.title,
    games,
    first
      ? ` · ${first.line}${first.zoneAbbr ? ` ${first.zoneAbbr}` : ''}${event.slots.length > 1 ? t(' 等 {0} 个时间', event.slots.length) : ''}`
      : '',
  )
  return (
    <Sheet open={props.open} onClose={props.onClose} title={props.created ? t('局开好了，丢到群里吧') : t('叫上朋友')}>
      <View className='sub mt4'>{t('已加入本空间的朋友登录后即可报名，时间会自动换成他们那边的。')}</View>
      <View className='share-text mt12'>
        {text}
        {'\n'}
        {url}
      </View>
      {isH5 ? (
        <View className='row gap8 mt16'>
          <Button kind='primary' className='flex1' onClick={() => void copyText(`${text}\n${url}`, t('复制好了，去群里粘贴吧'))}>
            {t('复制这段话')}
          </Button>
          <Button kind='outline' onClick={() => void shareText(event.title, text, url)}>
            {t('更多')}
          </Button>
        </View>
      ) : (
        <TaroButton className='btn btn--primary btn--block mt16' openType='share'>
          {t('发给微信好友 / 群')}
        </TaroButton>
      )}
      <View className='center mt12'>
        <Text className='link small' onClick={props.onClose}>
          {t('先这样')}
        </Text>
      </View>
    </Sheet>
  )
}

function AddSlotsSheet(props: { open: boolean; tz: string; onClose: () => void; onSave: (slots: SlotInput[]) => void }) {
  useLocale()
  const [slots, setSlots] = useState<SlotInput[]>([])
  return (
    <Sheet open={props.open} onClose={props.onClose} title={t('加几个时间')}>
      <View className='mt12'>
        <SlotEditor tz={props.tz} durationMin={120} value={slots} onChange={setSlots} />
      </View>
      <Button kind='primary' block className='mt16' disabled={slots.length === 0} onClick={() => props.onSave(slots)}>
        {t('添加{0}个时间', slots.length || '')}
      </Button>
    </Sheet>
  )
}

function InviteSheet(props: {
  open: boolean
  invitedIds: string[]
  onClose: () => void
  onSend: (userIds: string[], circleIds: string[]) => void
}) {
  const locale = useLocale()
  const [friends, setFriends] = useState<FriendsResponse['friends']>([])
  const [circles, setCircles] = useState<CirclesResponse['circles']>([])
  const [ids, setIds] = useState<string[]>([])
  const [circleIds, setCircleIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    if (!props.open) return
    setIds([])
    setCircleIds([])
  }, [props.open])
  useEffect(() => {
    if (!props.open) return
    let current = true
    setLoading(true)
    Promise.all([get<FriendsResponse>('/api/friends'), get<CirclesResponse>('/api/circles')])
      .then(([f, c]) => {
        if (!current) return
        setFriends(f.friends)
        setCircles(c.circles)
      })
      .catch(toastError)
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
    }
  }, [props.open, locale])
  const candidates = useMemo(() => friends.filter((f) => !props.invitedIds.includes(f.user.id)), [friends, props.invitedIds])
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  return (
    <Sheet open={props.open} onClose={props.onClose} title={t('再叫几个人')}>
      <View className='sub mt4'>{t('新邀请的人会收到一条通知，之前邀请过的人不会被重复打扰。')}</View>
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
        {loading && <Loading />}
        {!loading && candidates.length === 0 && <Text className='muted'>{t('好友都已经邀请过了')}</Text>}
        {candidates.map((f) => (
          <Chip key={f.user.id} small on={ids.includes(f.user.id)} onClick={() => setIds(toggle(ids, f.user.id))}>
            {f.user.avatar} {f.user.nickname}
          </Chip>
        ))}
      </View>
      <Button
        kind='primary'
        block
        className='mt16'
        disabled={ids.length + circleIds.length === 0}
        onClick={() => props.onSend(ids, circleIds)}
      >
        {t('叫他们')}
      </Button>
    </Sheet>
  )
}
