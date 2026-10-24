import {
  addSlotsSchema,
  cancelSchema,
  canPerform,
  checkRoster,
  confirmSchema,
  createEventSchema,
  CUSTOM_GAME_EMOJI,
  defaultTitle,
  DEFAULT_TIMEZONE,
  isValidTimeZone,
  MAX_SLOTS,
  deriveStatus,
  describeProgress,
  evaluateCombo,
  evaluateEvent,
  findGame,
  formatSlot,
  interestParticipants,
  inviteTargetsSchema,
  promoteSchema,
  respondSchema,
  slotInOtherZone,
  slotOneLine,
  statusText,
  type EventAction,
  type EventCard,
  type EventView,
  type ParticipantView,
  type SlotView,
  utcToLocal,
  type EventEvaluation,
  type EventOption,
  type EventResponse,
  type EventStatus,
  type GameEvent,
  type Invitation,
  type TimeSlot,
  type User,
  type UserId,
} from '@couju/core'
import type { Ctx } from './context'
import { notify } from './notify'
import { badRequest, forbidden, newId, notFound, randomCode, toPublic } from '../util'

// ---------- 内部工具 ----------

function loadEvent(ctx: Ctx, code: string): GameEvent {
  const event = ctx.store.getEventByCode(code)
  if (!event) throw notFound('活动不存在或链接有误')
  return refreshStatus(ctx, event)
}

/** 读取时按时间推导状态（过期/结束），变化则写回 */
export function refreshStatus(ctx: Ctx, event: GameEvent): GameEvent {
  const derived = deriveStatus(event, ctx.now())
  if (derived === event.status) return event
  const next = { ...event, status: derived, updatedAt: ctx.now().toISOString() }
  ctx.store.saveEvent(next)
  return next
}

function actorRole(event: GameEvent, me: User): 'host' | 'participant' {
  return event.hostId === me.id ? 'host' : 'participant'
}

function ensure(event: GameEvent, action: EventAction, me: User) {
  const r = canPerform(event.status, action, actorRole(event, me))
  if (!r.ok) throw r.reason.includes('组局的人') ? forbidden(r.reason) : badRequest(r.reason, 'invalid_state')
}

function canView(ctx: Ctx, event: GameEvent, viewer: User | undefined): boolean {
  if (event.visibility === 'link') return true
  if (!viewer) return false
  if (viewer.id === event.hostId) return true
  if (event.invitations.some((i) => i.userId === viewer.id)) return true
  return !!ctx.store.getResponse(event.id, viewer.id)
}

function optionOf(event: GameEvent, optionId: string): EventOption {
  const o = event.options.find((x) => x.id === optionId)
  if (!o) throw badRequest('玩法不存在')
  return o
}

function slotOf(event: GameEvent, slotId: string): TimeSlot {
  const s = event.slots.find((x) => x.id === slotId)
  if (!s) throw badRequest('时段不存在')
  return s
}

function eventLink(event: GameEvent) {
  return `/pages/event/detail?code=${event.code}`
}

/** 按接收者自己的时区描述时段 */
function slotTextFor(ctx: Ctx, userId: UserId, slot: TimeSlot): string {
  const u = ctx.store.getUser(userId)
  return slotOneLine(slot, u?.timezone ?? DEFAULT_TIMEZONE, ctx.now())
}

function resolveInvitees(ctx: Ctx, host: User, userIds: UserId[], circleIds: string[]): UserId[] {
  const friends = new Set(ctx.store.friendIds(host.id))
  const out = new Set<UserId>()
  ctx.store.assertMembers(userIds)
  if(userIds.some(id=>!friends.has(id))) throw badRequest('只能邀请当前空间的好友')
  for (const id of userIds) out.add(id)
  for (const cid of circleIds) {
    const c = ctx.store.getCircle(cid)
    if (!c || c.ownerId !== host.id) throw badRequest('圈子不存在或不属于你')
    for (const m of c.memberIds) if (friends.has(m)) out.add(m)
  }
  out.delete(host.id)
  return [...out]
}

function addInvitations(ctx: Ctx, event: GameEvent, host: User, ids: UserId[]): UserId[] {
  const existing = new Set(event.invitations.map((i) => i.userId))
  const fresh = ids.filter((id) => !existing.has(id) && id !== event.hostId)
  if (fresh.length === 0) return []
  const wave = event.invitations.reduce((m, i) => Math.max(m, i.wave), 0) + 1
  const at = ctx.now().toISOString()
  event.invitations.push(...fresh.map<Invitation>((userId) => ({ userId, wave, invitedAt: at })))
  for (const uid of fresh) {
    const first = event.slots.find((s) => Date.parse(s.startUtc) > ctx.now().getTime())
    notify(ctx, uid, {
      kind: 'event_invite',
      title: `${host.nickname} 约你：${event.title}`,
      body: first ? `${slotTextFor(ctx, uid, first)}${event.slots.length > 1 ? ` 等 ${event.slots.length} 个时间` : ''}，有空就来，没空不用回` : '',
      link: eventLink(event),
      dedupeKey: `invite:${event.id}`,
    })
  }
  return fresh
}

function toSlotView(slot: TimeSlot, viewerTz: string, hostTz: string, now: Date): SlotView {
  const d = formatSlot(slot, viewerTz, now)
  return {
    ...slot,
    ...d,
    line: slotOneLine(slot, viewerTz, now),
    localDate: utcToLocal(slot.startUtc, viewerTz).slice(0, 10),
    hostLine: viewerTz === hostTz ? null : slotInOtherZone(slot, viewerTz, hostTz),
  }
}

// ---------- 读取 ----------

export function getEventView(ctx: Ctx, code: string, viewer: User | undefined, viewerTzHint?: string): EventView {
  const event = loadEvent(ctx, code)
  const host = ctx.store.getUser(event.hostId)
  if (!host) throw notFound('发起人不存在')
  const now = ctx.now()
  const viewerTz = viewer?.timezone ?? (viewerTzHint && isValidTimeZone(viewerTzHint) ? viewerTzHint : DEFAULT_TIMEZONE)
  const role = !viewer ? 'anonymous' : viewer.id === event.hostId ? 'host' : 'participant'
  const invited = !!viewer && event.invitations.some((i) => i.userId === viewer.id)
  const { invitations: _omit, slots, ...rest } = event
  const allowed = canView(ctx, event, viewer)

  if (!allowed) {
    return {
      event: { ...rest, note: '', location: '', final: null, slots: [], statusText: statusText(event.status) },
      host: toPublic(host),
      viewer: { role, timezone: viewerTz, invited: false, canRespond: false, response: null, inRoster: false, inWaitlist: false },
      restricted: true,
      participants: [],
      evaluation: null,
      rosterCheck: null,
      hostOnly: null,
    }
  }

  const responses = ctx.store.listResponses(event.id)
  const users = new Map(ctx.store.getUsers(responses.map((r) => r.userId)).map((u) => [u.id, u]))
  const visible = responses
    .filter((r) => r.intent !== 'declined')
    .sort((a, b) => a.seq - b.seq)
    .flatMap<ParticipantView>((r) => {
      const u = users.get(r.userId)
      if (!u) return []
      return [
        {
          user: toPublic(u),
          intent: r.intent as ParticipantView['intent'],
          availability: r.availability,
          optionIds: r.optionIds,
          roles: r.roles,
          finalConfirmed: r.finalConfirmed,
          comment: r.comment,
        },
      ]
    })
  const myResponse = viewer ? (responses.find((r) => r.userId === viewer.id) ?? null) : null
  const actor = role === 'host' ? 'host' : 'participant'
  const canRespond = canPerform(event.status, 'respond', actor).ok

  let rosterCheck: EventView['rosterCheck'] = null
  if (event.final && (event.status === 'confirmed' || event.status === 'completed')) {
    const option = event.options.find((o) => o.id === event.final!.optionId)
    if (option) {
      const c = checkRoster(option, event.final.rosterIds, responses)
      rosterCheck = { ok: c.ok, stillNeed: c.stillNeed, missingRoles: c.missingRoles }
    }
  }

  let hostOnly: EventView['hostOnly'] = null
  if (role === 'host') {
    const invitedUsers = new Map(ctx.store.getUsers(event.invitations.map((i) => i.userId)).map((u) => [u.id, u]))
    const respondedVisible = new Set(visible.map((p) => p.user.id))
    hostOnly = {
      // 只给匿名人数：不让任何人知道具体是谁拒绝了
      declinedCount: responses.filter((r) => r.intent === 'declined').length,
      invitees: event.invitations.flatMap((i) => {
        const u = invitedUsers.get(i.userId)
        return u ? [{ user: toPublic(u), wave: i.wave, responded: respondedVisible.has(u.id) }] : []
      }),
    }
  }

  return {
    event: {
      ...rest,
      slots: slots.map((s) => toSlotView(s, viewerTz, event.hostTimezone, now)),
      statusText: statusText(event.status),
    },
    host: toPublic(host),
    viewer: {
      role,
      timezone: viewerTz,
      invited,
      canRespond,
      response: myResponse,
      inRoster: !!viewer && !!event.final?.rosterIds.includes(viewer.id),
      inWaitlist: !!viewer && !!event.final?.waitlistIds.includes(viewer.id),
    },
    restricted: false,
    participants: visible,
    evaluation: event.status === 'open' ? evaluateEvent(event, responses, now) : null,
    rosterCheck,
    hostOnly,
  }
}

export function listMyEvents(ctx: Ctx, me: User): { active: EventCard[]; past: EventCard[] } {
  const now = ctx.now()
  const events = ctx.store.listEventsForUser(me.id).map((e) => refreshStatus(ctx, e))
  const hosts = new Map(ctx.store.getUsers(events.map((e) => e.hostId)).map((u) => [u.id, u]))
  const cards: EventCard[] = []
  for (const e of events) {
    const host = hosts.get(e.hostId)
    if (!host) continue
    const responses = ctx.store.listResponses(e.id)
    const mine = responses.find((r) => r.userId === me.id) ?? null
    const futureSlots = e.slots.filter((s) => Date.parse(s.startUtc) > now.getTime())
    let whenText = ''
    let progress = ''
    let nextStartUtc: string | null = null
    if (e.final) {
      const slot = e.slots.find((s) => s.id === e.final!.slotId)
      const option = e.options.find((o) => o.id === e.final!.optionId)
      if (slot) {
        whenText = slotOneLine(slot, me.timezone, now)
        nextStartUtc = slot.startUtc
      }
      if (option) progress = `${option.emoji} ${option.name} · ${e.final.rosterIds.length}/${option.maxPlayers} 人`
    } else {
      const first = futureSlots[0] ?? e.slots[0]
      if (first) {
        whenText = slotOneLine(first, me.timezone, now) + (e.slots.length > 1 ? ` 等 ${e.slots.length} 个时间` : '')
        nextStartUtc = futureSlots[0]?.startUtc ?? null
      }
      if (e.status === 'open') {
        const best = evaluateEvent(e, responses, now).best
        progress = best ? describeProgress(best) : '没有可选的时间了'
      }
    }
    const isHost = e.hostId === me.id
    cards.push({
      code: e.code,
      title: e.title,
      status: e.status,
      statusText: statusText(e.status),
      isHost,
      host: toPublic(host),
      options: e.options.map((o) => ({ emoji: o.emoji, name: o.name })),
      whenText,
      progress,
      myIntent: mine?.intent ?? null,
      needsMyResponse: !isHost && !mine && e.status === 'open',
      joinedCount: responses.filter((r) => r.intent === 'joined').length,
      nextStartUtc,
    })
  }
  const isActive = (c: EventCard) => c.status === 'open' || c.status === 'confirmed'
  const active = cards
    .filter(isActive)
    .sort(
      (a, b) =>
        Number(b.needsMyResponse) - Number(a.needsMyResponse) ||
        (a.nextStartUtc ?? '9').localeCompare(b.nextStartUtc ?? '9'),
    )
  const past = cards.filter((c) => !isActive(c)).slice(0, 10)
  return { active, past }
}

// ---------- 创建 ----------

export function createEvent(ctx: Ctx, me: User, raw: unknown): GameEvent {
  const input = createEventSchema.parse(raw)
  const now = ctx.now()
  const nowIso = now.toISOString()

  const seen = new Set<string>()
  const slots: TimeSlot[] = input.slots
    .map((s) => ({ startUtc: new Date(s.startUtc).toISOString(), endUtc: s.endUtc ? new Date(s.endUtc).toISOString() : null }))
    .filter((s) => (seen.has(s.startUtc) ? false : (seen.add(s.startUtc), true)))
    .sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    .map((s, i) => ({ id: `s${i + 1}`, ...s }))
  if (slots.some((s) => Date.parse(s.startUtc) < now.getTime() - 5 * 60_000)) throw badRequest('有时间已经过去了，请重新选择')

  const options: EventOption[] = input.options.map((o, i) => {
    const game = findGame(o.gameKey)
    return {
      id: `o${i + 1}`,
      gameKey: game ? game.key : null,
      name: o.name,
      emoji: o.emoji || game?.emoji || CUSTOM_GAME_EMOJI,
      minPlayers: o.minPlayers,
      maxPlayers: o.maxPlayers,
      roles: o.roles,
    }
  })

  return ctx.store.tx(() => {
    let code = randomCode(8)
    while (ctx.store.getEventByCode(code)) code = randomCode(8)

    const event: GameEvent = {
      id: newId('e'),
      code,
      hostId: me.id,
      title: input.title || defaultTitle(options.map((o) => o.name), null),
      note: input.note,
      mode: input.mode,
      location: input.location,
      hostTimezone: me.timezone,
      options,
      slots,
      visibility: input.visibility,
      invitations: [],
      allowWaitlist: input.allowWaitlist,
      status: 'open',
      final: null,
      cancelReason: '',
      sourceInterestId: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    // 由“我想玩”转成正式活动：标记转化，并邀请当初 +1 的人（他们主动表达过兴趣）
    let extraInvitees: UserId[] = []
    if (input.sourceInterestId) {
      const interest = ctx.store.getInterest(input.sourceInterestId)
      if (!interest || interest.status !== 'active') throw badRequest('这条“想玩”已失效')
      const people = interestParticipants(interest)
      if (!people.includes(me.id)) throw forbidden('只有参与者可以发起')
      extraInvitees = people.filter((id) => id !== me.id)
      event.sourceInterestId = interest.id
      ctx.store.saveInterest({ ...interest, status: 'converted', convertedEventId: event.id })
    }

    const invitees = [...new Set([...resolveInvitees(ctx, me, input.invite.userIds, input.invite.circleIds), ...extraInvitees])]
    ctx.store.saveEvent(event)
    addInvitations(ctx, event, me, invitees)

    if (input.hostJoins) {
      const roleKeys = new Set(options.flatMap((o) => o.roles.map((r) => r.key)))
      ctx.store.saveResponse({
        eventId: event.id,
        userId: me.id,
        intent: 'joined',
        availability: Object.fromEntries(slots.map((s) => [s.id, 'yes' as const])),
        optionIds: [],
        roles: input.hostRoles.filter((r) => roleKeys.has(r)),
        finalConfirmed: false,
        comment: '',
        seq: ctx.store.nextSeq('response'),
        createdAt: nowIso,
        updatedAt: nowIso,
      })
    }
    ctx.store.saveEvent(event)
    return event
  })
}

// ---------- 报名 ----------

/** 成团后，报名变化同步到名单：新报名补位/候补，取消则移出名单 */
function syncFinal(ctx: Ctx, event: GameEvent, resp: EventResponse) {
  const final = event.final
  if (!final) return
  const option = optionOf(event, final.optionId)
  const uid = resp.userId
  const inRoster = final.rosterIds.includes(uid)
  const inWait = final.waitlistIds.includes(uid)
  const eligible =
    resp.intent === 'joined' &&
    resp.availability[final.slotId] === 'yes' &&
    (resp.optionIds.length === 0 || resp.optionIds.includes(final.optionId))

  if (eligible && !inRoster && !inWait) {
    if (final.rosterIds.length < option.maxPlayers) final.rosterIds.push(uid)
    else if (event.allowWaitlist) final.waitlistIds.push(uid)
  }
  if (!eligible && (inRoster || inWait)) {
    final.rosterIds = final.rosterIds.filter((x) => x !== uid)
    final.waitlistIds = final.waitlistIds.filter((x) => x !== uid)
    if (inRoster) {
      const responses = ctx.store.listResponses(event.id)
      const check = checkRoster(option, final.rosterIds, responses)
      if (!check.ok) {
        const who = ctx.store.getUser(uid)?.nickname ?? '有人'
        notify(ctx, event.hostId, {
          kind: 'event_short',
          title: `「${event.title}」${who} 临时有事`,
          body: final.waitlistIds.length > 0 ? `还差 ${check.stillNeed} 个，候补里有 ${final.waitlistIds.length} 人可以补上` : `还差 ${check.stillNeed} 个，可以再叫几个人，或者重新开放`,
          link: eventLink(event),
          dedupeKey: `short:${event.id}:${uid}`,
        })
      }
    }
  }
  const responses = ctx.store.listResponses(event.id)
  final.roleAssignments = checkRoster(option, final.rosterIds, responses).roleAssignments
}

function applyResponse(ctx: Ctx, me: User, event: GameEvent, input: ReturnType<typeof respondSchema.parse>) {
  const now = ctx.now()
  const slotIds = new Set(event.slots.map((s) => s.id))
  const optionIds = new Set(event.options.map((o) => o.id))
  const roleKeys = new Set(event.options.flatMap((o) => o.roles.map((r) => r.key)))

  let availability = Object.fromEntries(Object.entries(input.availability).filter(([k]) => slotIds.has(k)))
  if (input.intent === 'joined' && event.slots.length === 1 && Object.keys(availability).length === 0) {
    availability = { [event.slots[0]!.id]: 'yes' }
  }
  if (input.intent === 'joined') {
    const futureYes = Object.entries(availability).some(
      ([k, v]) => v === 'yes' && Date.parse(event.slots.find((s) => s.id === k)!.startUtc) > now.getTime(),
    )
    if (!futureYes) throw badRequest('请至少选一个可以参加的时间', 'no_slot')
  }
  if (input.intent === 'declined') availability = {}

  const existing = ctx.store.getResponse(event.id, me.id)
  const before = event.status === 'open' ? evaluateEvent(event, ctx.store.listResponses(event.id), now) : null
  const keepSeq = existing && existing.intent === 'joined' && input.intent === 'joined'
  const resp: EventResponse = {
    eventId: event.id,
    userId: me.id,
    intent: input.intent,
    availability,
    optionIds: input.optionIds.filter((o) => optionIds.has(o)),
    roles: input.roles.filter((r) => roleKeys.has(r)),
    finalConfirmed: existing?.finalConfirmed ?? false,
    comment: input.comment,
    seq: keepSeq ? existing!.seq : ctx.store.nextSeq('response'),
    createdAt: existing?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
  }
  if (resp.intent !== 'joined') resp.finalConfirmed = false
  ctx.store.saveResponse(resp)

  if (event.status === 'open' && before) {
    const after = evaluateEvent(event, ctx.store.listResponses(event.id), now)
    if (!before.anyFeasible && after.anyFeasible && after.best && me.id !== event.hostId) {
      const option = optionOf(event, after.best.optionId)
      const slot = slotOf(event, after.best.slotId)
      notify(ctx, event.hostId, {
        kind: 'event_ready',
        title: `「${event.title}」人齐了`,
        body: `${slotTextFor(ctx, event.hostId, slot)} · ${option.emoji} ${option.name} ${after.best.roster.length} 人，点一下就定了`,
        link: eventLink(event),
        dedupeKey: `ready:${event.id}:${after.best.optionId}:${after.best.slotId}`,
      })
    }
    // 只差 1 人时，温和提醒“待定/想玩”的人（每个活动 24 小时最多一次），不提醒没回应的人
    if (!after.anyFeasible && after.best?.stillNeed === 1) {
      const option = optionOf(event, after.best.optionId)
      const slot = slotOf(event, after.best.slotId)
      for (const r of ctx.store.listResponses(event.id)) {
        if (r.userId === me.id || (r.intent !== 'maybe' && r.intent !== 'interested')) continue
        notify(ctx, r.userId, {
          kind: 'event_short',
          title: `「${event.title}」就差一个`,
          body: `${slotTextFor(ctx, r.userId, slot)} · ${option.name}，方便就来，不方便当没看见就好`,
          link: eventLink(event),
          dedupeKey: `short:${event.id}`,
        })
      }
    }
  }

  if (event.status === 'confirmed') syncFinal(ctx, event, resp)
  event.updatedAt = now.toISOString()
  ctx.store.saveEvent(event)
}

export function respond(ctx: Ctx, me: User, code: string, raw: unknown): void {
  const input = respondSchema.parse(raw)
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    if (!canView(ctx, event, me)) throw forbidden('这是仅邀请可见的活动，请联系发起人邀请你', 'not_invited')
    ensure(event, input.intent === 'declined' && event.status === 'confirmed' ? 'withdraw' : 'respond', me)
    applyResponse(ctx, me, event, input)
  })
}

export function withdraw(ctx: Ctx, me: User, code: string): void {
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    if (!ctx.store.getResponse(event.id, me.id)) return
    ensure(event, 'withdraw', me)
    applyResponse(ctx, me, event, respondSchema.parse({ intent: 'declined' }))
  })
}

export function finalConfirm(ctx: Ctx, me: User, code: string): void {
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    ensure(event, 'final_confirm', me)
    if (!event.final?.rosterIds.includes(me.id)) throw badRequest('你不在正式名单里')
    const r = ctx.store.getResponse(event.id, me.id)
    if (!r) throw badRequest('你还没有报名')
    ctx.store.saveResponse({ ...r, finalConfirmed: true, updatedAt: ctx.now().toISOString() })
  })
}

// ---------- 发起人操作 ----------

export function confirmEvent(ctx: Ctx, me: User, code: string, raw: unknown): void {
  const input = confirmSchema.parse(raw)
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    ensure(event, 'confirm', me)
    const option = optionOf(event, input.optionId)
    const slot = slotOf(event, input.slotId)
    if (Date.parse(slot.startUtc) <= ctx.now().getTime()) throw badRequest('这个时间已经过了')
    const responses = ctx.store.listResponses(event.id)
    // 成团判断以后端规则引擎为准
    const combo = evaluateCombo(event, option, slot, responses)
    if (!combo.feasible) throw badRequest(`还不能成团：${describeProgress(combo)}`, 'not_feasible')

    const now = ctx.now().toISOString()
    event.status = 'confirmed'
    event.final = {
      optionId: option.id,
      slotId: slot.id,
      rosterIds: combo.roster,
      waitlistIds: event.allowWaitlist ? combo.waitlist : [],
      roleAssignments: combo.roleAssignments,
      confirmedAt: now,
    }
    event.updatedAt = now
    ctx.store.saveEvent(event)

    const hostResp = responses.find((r) => r.userId === me.id)
    if (hostResp && combo.roster.includes(me.id)) ctx.store.saveResponse({ ...hostResp, finalConfirmed: true, updatedAt: now })

    for (const uid of combo.roster) {
      if (uid === me.id) continue
      notify(ctx, uid, {
        kind: 'event_confirmed',
        title: `「${event.title}」成了！`,
        body: `${slotTextFor(ctx, uid, slot)} · ${option.emoji} ${option.name}，点开说一声你会来`,
        link: eventLink(event),
        dedupeKey: `confirmed:${event.id}`,
      })
    }
    for (const uid of event.final.waitlistIds) {
      notify(ctx, uid, {
        kind: 'event_confirmed',
        title: `「${event.title}」成了，你在候补`,
        body: `${slotTextFor(ctx, uid, slot)}，有人鸽了会第一时间叫你`,
        link: eventLink(event),
        dedupeKey: `confirmed:${event.id}`,
      })
    }
  })
}

export function promoteWaitlist(ctx: Ctx, me: User, code: string, raw: unknown): void {
  const { userId } = promoteSchema.parse(raw)
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    ensure(event, 'promote', me)
    const final = event.final!
    if (!final.waitlistIds.includes(userId)) throw badRequest('这个人不在候补名单')
    const option = optionOf(event, final.optionId)
    if (final.rosterIds.length >= option.maxPlayers) throw badRequest('正式名单已满')
    final.waitlistIds = final.waitlistIds.filter((x) => x !== userId)
    final.rosterIds.push(userId)
    final.roleAssignments = checkRoster(option, final.rosterIds, ctx.store.listResponses(event.id)).roleAssignments
    event.updatedAt = ctx.now().toISOString()
    ctx.store.saveEvent(event)
    const slot = slotOf(event, final.slotId)
    notify(ctx, userId, {
      kind: 'waitlist_promoted',
      title: `「${event.title}」空出一个位置`,
      body: `${slotTextFor(ctx, userId, slot)}，轮到你了！点开说一声你会来`,
      link: eventLink(event),
      dedupeKey: `promoted:${event.id}:${userId}`,
    })
  })
}

export function reopenEvent(ctx: Ctx, me: User, code: string): void {
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    ensure(event, 'reopen', me)
    event.status = 'open'
    event.final = null
    event.updatedAt = ctx.now().toISOString()
    ctx.store.saveEvent(event)
    for (const r of ctx.store.listResponses(event.id)) {
      if (r.finalConfirmed) ctx.store.saveResponse({ ...r, finalConfirmed: false })
    }
    // 重新开放后若已没有未来时段，立即变为过期
    refreshStatus(ctx, event)
  })
}

export function cancelEvent(ctx: Ctx, me: User, code: string, raw: unknown): void {
  const { reason } = cancelSchema.parse(raw)
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    ensure(event, 'cancel', me)
    event.status = 'cancelled'
    event.cancelReason = reason
    event.updatedAt = ctx.now().toISOString()
    ctx.store.saveEvent(event)
    for (const r of ctx.store.listResponses(event.id)) {
      if (r.userId === me.id || r.intent === 'declined') continue
      notify(ctx, r.userId, {
        kind: 'event_cancelled',
        title: `「${event.title}」这局取消了`,
        body: reason || '发起人取消了这次活动，下次再约',
        link: eventLink(event),
        dedupeKey: `cancelled:${event.id}`,
      })
    }
  })
}

/** 扩大邀请：追加一批邀请（批次号 +1），只通知新加入的人 */
export function inviteMore(ctx: Ctx, me: User, code: string, raw: unknown): { added: number } {
  const input = inviteTargetsSchema.parse(raw)
  return ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    ensure(event, 'invite', me)
    const ids = resolveInvitees(ctx, me, input.userIds, input.circleIds)
    const added = addInvitations(ctx, event, me, ids)
    event.updatedAt = ctx.now().toISOString()
    ctx.store.saveEvent(event)
    return { added: added.length }
  })
}

export function addSlots(ctx: Ctx, me: User, code: string, raw: unknown): void {
  const input = addSlotsSchema.parse(raw)
  ctx.store.tx(() => {
    const event = loadEvent(ctx, code)
    ensure(event, 'add_slots', me)
    const now = ctx.now().getTime()
    const existing = new Set(event.slots.map((s) => s.startUtc))
    let n = event.slots.reduce((m, s) => Math.max(m, Number(s.id.slice(1)) || 0), 0)
    for (const s of input.slots) {
      const startUtc = new Date(s.startUtc).toISOString()
      if (Date.parse(startUtc) <= now) throw badRequest('有时间已经过去了')
      if (existing.has(startUtc)) continue
      existing.add(startUtc)
      event.slots.push({ id: `s${++n}`, startUtc, endUtc: s.endUtc ? new Date(s.endUtc).toISOString() : null })
    }
    if (event.slots.length > MAX_SLOTS) throw badRequest(`最多 ${MAX_SLOTS} 个候选时间`)
    event.slots.sort((a, b) => a.startUtc.localeCompare(b.startUtc))
    if (event.status === 'expired') event.status = 'open'
    event.updatedAt = ctx.now().toISOString()
    ctx.store.saveEvent(event)
  })
}

export type { EventCard, EventView, ParticipantView, SlotView }
