import {
  CUSTOM_GAME_EMOJI,
  createInterestSchema,
  findGame,
  interestHeadcount,
  interestParticipants,
  interestReady,
  interestStillNeed,
  interestVisibleTo,
  isInterestExpired,
  type Interest,
  type InterestView,
  type User,
  type UserId,
} from '@couju/core'
import type { Ctx } from './context'
import { notify } from './notify'
import { badRequest, forbidden, newId, notFound, toPublic } from '../util'

/**
 * “我想玩”：表达兴趣，不承担组织责任。
 * - 只有发起者选定范围内的好友能看到（默认仅常玩好友）。
 * - 其他人只能看到 +1 的人数；发起者和参与者能看到具体是谁。
 * - 到期自动失效；人够了任何参与者都可以一键转为正式活动。
 */

function visibilityCtx(ctx: Ctx, interest: Interest) {
  const ownerFriendIds = new Set(ctx.store.friendIds(interest.ownerId))
  const ownerFavoriteIds = new Set(ctx.store.getPrefs(interest.ownerId).filter((p) => p.favorite).map((p) => p.friendId))
  const circleMemberIds = new Set<UserId>()
  if (interest.audience.kind === 'circles') {
    for (const cid of interest.audience.circleIds) {
      const c = ctx.store.getCircle(cid)
      if (c && c.ownerId === interest.ownerId) c.memberIds.forEach((m) => circleMemberIds.add(m))
    }
  }
  return { ownerFriendIds, ownerFavoriteIds, circleMemberIds }
}

function audienceIds(ctx: Ctx, interest: Interest): UserId[] {
  const v = visibilityCtx(ctx, interest)
  return [...v.ownerFriendIds].filter((id) => interestVisibleTo(interest, id, v))
}

function expireIfNeeded(ctx: Ctx, interest: Interest): Interest {
  if (!isInterestExpired(interest, ctx.now())) return interest
  const next = { ...interest, status: 'expired' as const }
  ctx.store.saveInterest(next)
  return next
}

function toView(ctx: Ctx, interest: Interest, me: User): InterestView {
  const people = interestParticipants(interest)
  const isParticipant = people.includes(me.id)
  const users = new Map(ctx.store.getUsers(people).map((u) => [u.id, u]))
  const owner = users.get(interest.ownerId)!
  const converted = interest.convertedEventId ? ctx.store.getEvent(interest.convertedEventId) : undefined
  return {
    id: interest.id,
    owner: toPublic(owner),
    gameKey: interest.gameKey,
    name: interest.name,
    emoji: interest.emoji,
    minPlayers: interest.minPlayers,
    whenHint: interest.whenHint,
    note: interest.note,
    status: interest.status,
    convertedEventCode: converted?.code ?? null,
    expiresAt: interest.expiresAt,
    headcount: interestHeadcount(interest),
    stillNeed: interestStillNeed(interest),
    ready: interestReady(interest),
    participants: isParticipant ? people.flatMap((id) => (users.get(id) ? [toPublic(users.get(id)!)] : [])) : null,
    joinedByMe: interest.joiners.some((j) => j.userId === me.id),
    isMine: interest.ownerId === me.id,
  }
}

export function createInterest(ctx: Ctx, me: User, raw: unknown): InterestView {
  const input = createInterestSchema.parse(raw)
  if(input.audience.kind==='circles' && input.audience.circleIds.some(id=>ctx.store.getCircle(id)?.ownerId!==me.id)) throw badRequest('只能选择当前空间内自己的圈子')
  const game = findGame(input.gameKey)
  const name = game?.name ?? input.name
  if (!name) throw badRequest('想玩什么？')
  const now = ctx.now()
  const active = ctx.store.listInterestsByOwners([me.id]).filter((i) => i.status === 'active' && !isInterestExpired(i, now))
  if (active.length >= 5) throw badRequest('同时最多挂 5 条“想玩”，先撤掉一条吧')

  const interest: Interest = {
    id: newId('i'),
    ownerId: me.id,
    gameKey: game?.key ?? null,
    name,
    emoji: game?.emoji ?? input.emoji ?? CUSTOM_GAME_EMOJI,
    minPlayers: input.minPlayers ?? game?.minPlayers ?? 2,
    whenHint: input.whenHint,
    note: input.note,
    audience: input.audience,
    joiners: [],
    status: 'active',
    convertedEventId: null,
    expiresAt: new Date(now.getTime() + input.ttlDays * 24 * 3600_000).toISOString(),
    createdAt: now.toISOString(),
  }
  return ctx.store.tx(() => {
    ctx.store.saveInterest(interest)
    for (const uid of audienceIds(ctx, interest)) {
      notify(ctx, uid, {
        kind: 'interest_new', objectId: interest.id,
        title: `${me.nickname} 举手想玩 ${interest.emoji} ${interest.name}`,
        body: `${interest.whenHint ? `${interest.whenHint}，` : ''}想玩就 +1，不想玩当没看见`,
        link: '/pages/index/index',
        dedupeKey: `interest:${me.id}:${interest.gameKey ?? interest.name}`,
      })
    }
    return toView(ctx, interest, me)
  })
}

/** 首页“朋友们想玩”：我能看到的、仍有效的想玩 + 我自己的 */
export function listInterests(ctx: Ctx, me: User): { mine: InterestView[]; friends: InterestView[] } {
  const friendIds = ctx.store.friendIds(me.id)
  const candidates = ctx.store.listInterestsByOwners([me.id, ...friendIds]).map((i) => expireIfNeeded(ctx, i))
  const recent = (i: Interest) => i.status === 'active' || (i.status === 'converted' && Date.parse(i.createdAt) > ctx.now().getTime() - 7 * 24 * 3600_000)
  const mine = candidates
    .filter((i) => recent(i) && (i.ownerId === me.id || i.joiners.some((j) => j.userId === me.id)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const mineIds = new Set(mine.map((i) => i.id))
  const friends = candidates
    .filter((i) => i.status === 'active' && !mineIds.has(i.id) && interestVisibleTo(i, me.id, visibilityCtx(ctx, i)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { mine: mine.map((i) => toView(ctx, i, me)), friends: friends.map((i) => toView(ctx, i, me)) }
}

function loadVisible(ctx: Ctx, me: User, id: string): Interest {
  const raw = ctx.store.getInterest(id)
  if (!raw) throw notFound('这条“想玩”不存在')
  const interest = expireIfNeeded(ctx, raw)
  const isParticipant = interestParticipants(interest).includes(me.id)
  if (!isParticipant && !interestVisibleTo(interest, me.id, visibilityCtx(ctx, interest))) throw notFound('这条“想玩”不存在')
  return interest
}

export function joinInterest(ctx: Ctx, me: User, id: string): InterestView {
  return ctx.store.tx(() => {
    const interest = loadVisible(ctx, me, id)
    if (interest.status !== 'active') throw badRequest('这条“想玩”已经结束了')
    if (interest.ownerId === me.id) throw badRequest('这是你自己发的')
    if (interest.joiners.some((j) => j.userId === me.id)) return toView(ctx, interest, me)
    const wasReady = interestReady(interest)
    const next: Interest = { ...interest, joiners: [...interest.joiners, { userId: me.id, at: ctx.now().toISOString() }] }
    ctx.store.saveInterest(next)
    if (!wasReady && interestReady(next)) {
      for (const uid of interestParticipants(next)) {
        notify(ctx, uid, {
          kind: 'interest_ready', objectId: next.id,
          title: `${next.emoji} ${next.name} 人齐了（${interestHeadcount(next)} 个）`,
          body: '谁有空谁来定个时间，就能开了',
          link: '/pages/index/index',
          dedupeKey: `interest_ready:${next.id}`,
        })
      }
    }
    return toView(ctx, next, me)
  })
}

export function leaveInterest(ctx: Ctx, me: User, id: string): InterestView {
  return ctx.store.tx(() => {
    const interest = loadVisible(ctx, me, id)
    const next = { ...interest, joiners: interest.joiners.filter((j) => j.userId !== me.id) }
    ctx.store.saveInterest(next)
    return toView(ctx, next, me)
  })
}

export function withdrawInterest(ctx: Ctx, me: User, id: string): void {
  const interest = ctx.store.getInterest(id)
  if (!interest) throw notFound('这条“想玩”不存在')
  if (interest.ownerId !== me.id) throw forbidden()
  if (interest.status === 'active') ctx.store.saveInterest({ ...interest, status: 'withdrawn' })
}

/** 定期清理过期的“想玩”（服务启动时与每小时执行） */
export function sweepExpiredInterests(ctx: Ctx): number {
  let n = 0
  for (const i of ctx.store.listInterestsByStatus('active')) {
    if (isInterestExpired(i, ctx.now())) {
      ctx.store.saveInterest({ ...i, status: 'expired' })
      n++
    }
  }
  return n
}
