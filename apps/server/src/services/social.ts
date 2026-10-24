import { message } from '@couju/core'
import {
  circleSchema,
  friendPrefSchema,
  friendRequestSchema,
  type Circle,
  type FriendEntry,
  type Friendship,
  type PublicUser,
  type User,
  type UserId,
} from '@couju/core'
import type { Ctx } from './context'
import { notify } from './notify'
import { badRequest, forbidden, newId, notFound, toPublic } from '../util'

/**
 * 好友与圈子。
 * 隐私原则：常玩标记、圈子、邀请批次只对本人可见；不提供亲密度评分，
 * 也不向任何人展示“谁和谁不熟”。
 */

export function listFriends(ctx: Ctx, me: User) {
  const all = ctx.store.listFriendships(me.id)
  const otherId = (f: Friendship) => (f.a === me.id ? f.b : f.a)
  const users = new Map(ctx.store.getUsers(all.map(otherId)).map((u) => [u.id, u]))
  const prefs = new Map(ctx.store.getPrefs(me.id).map((p) => [p.friendId, p.favorite]))
  const friends: FriendEntry[] = []
  const incoming: PublicUser[] = []
  const outgoing: PublicUser[] = []
  for (const f of all) {
    const u = users.get(otherId(f))
    if (!u) continue
    if (f.status === 'accepted') friends.push({ user: toPublic(u), favorite: prefs.get(u.id) ?? false, since: f.acceptedAt ?? f.createdAt })
    else if (f.requestedBy === me.id) outgoing.push(toPublic(u))
    else incoming.push(toPublic(u))
  }
  friends.sort((x, y) => Number(y.favorite) - Number(x.favorite) || x.user.nickname.localeCompare(y.user.nickname, 'zh'))
  return { friends, incoming, outgoing }
}

/** 发送好友请求；如果对方已经向我发过请求，则直接成为好友。 */
export function requestFriend(ctx: Ctx, me: User, raw: unknown): { status: 'pending' | 'accepted'; user: PublicUser } {
  const { handle } = friendRequestSchema.parse(raw)
  const target = ctx.store.getUserByHandle(handle)
  if (!target || !ctx.store.isMember(target.id)) throw notFound('找不到这个 ID')
  if (target.id === me.id) throw badRequest('不能加自己为好友')
  return ctx.store.tx(() => {
    const existing = ctx.store.getFriendship(me.id, target.id)
    const now = ctx.now().toISOString()
    if (existing?.status === 'accepted') return { status: 'accepted' as const, user: toPublic(target) }
    if (existing && existing.requestedBy === target.id) {
      ctx.store.saveFriendship({ ...existing, status: 'accepted', acceptedAt: now })
      notify(ctx, target.id, {
        kind: 'friend_accepted',
        title: message("{0} 和你成为了好友", me.nickname),
        body: '',
        link: '/pages/friends/index',
        dedupeKey: `friend_accepted:${me.id}`,
      })
      return { status: 'accepted' as const, user: toPublic(target) }
    }
    if (!existing) {
      const [a, b] = me.id < target.id ? [me.id, target.id] : [target.id, me.id]
      ctx.store.saveFriendship({ id: newId('f'), a, b, status: 'pending', requestedBy: me.id, createdAt: now })
      notify(ctx, target.id, {
        kind: 'friend_request',
        title: message("{0} 想加你为好友", me.nickname),
        body: message("在“好友”页可以接受"),
        link: '/pages/friends/index',
        dedupeKey: `friend_request:${me.id}`,
      })
    }
    return { status: 'pending' as const, user: toPublic(target) }
  })
}

export function acceptFriend(ctx: Ctx, me: User, otherId: UserId) {
  const f = ctx.store.getFriendship(me.id, otherId)
  if (!f || f.status !== 'pending' || f.requestedBy === me.id) throw notFound('没有待处理的好友请求')
  ctx.store.tx(() => {
    ctx.store.saveFriendship({ ...f, status: 'accepted', acceptedAt: ctx.now().toISOString() })
    notify(ctx, otherId, {
      kind: 'friend_accepted',
      title: message("{0} 接受了你的好友请求", me.nickname),
      body: '',
      link: '/pages/friends/index',
      dedupeKey: `friend_accepted:${me.id}`,
    })
  })
}

/** 删除好友（或拒绝/撤回请求）。双方的私密标记和圈子成员关系一并清除，不通知对方。 */
export function removeFriend(ctx: Ctx, me: User, otherId: UserId) {
  const f = ctx.store.getFriendship(me.id, otherId)
  if (!f) return
  ctx.store.tx(() => {
    ctx.store.deleteFriendship(f.id)
    ctx.store.deletePref(me.id, otherId)
    ctx.store.deletePref(otherId, me.id)
    for (const [owner, member] of [
      [me.id, otherId],
      [otherId, me.id],
    ] as const) {
      for (const c of ctx.store.listCircles(owner)) {
        if (c.memberIds.includes(member)) ctx.store.saveCircle({ ...c, memberIds: c.memberIds.filter((m) => m !== member) })
      }
    }
  })
}

export function setFavorite(ctx: Ctx, me: User, friendId: UserId, raw: unknown) {
  const { favorite } = friendPrefSchema.parse(raw)
  if (!ctx.store.friendIds(me.id).includes(friendId)) throw notFound('不是好友')
  ctx.store.setPref({ ownerId: me.id, friendId, favorite })
}

// ---------- 圈子 ----------

export function listCircles(ctx: Ctx, me: User) {
  const circles = ctx.store.listCircles(me.id)
  return circles
}

function sanitizeMembers(ctx: Ctx, me: User, memberIds: UserId[]): UserId[] {
  const friends = new Set(ctx.store.friendIds(me.id))
  ctx.store.assertMembers(memberIds)
  if(memberIds.some(id=>!friends.has(id))) throw badRequest('只能选择当前空间的好友')
  return [...new Set(memberIds)]
}

export function createCircle(ctx: Ctx, me: User, raw: unknown): Circle {
  const input = circleSchema.parse(raw)
  if (ctx.store.listCircles(me.id).length >= 20) throw badRequest('圈子最多 20 个')
  const circle: Circle = {
    id: newId('c'),
    ownerId: me.id,
    name: input.name,
    memberIds: sanitizeMembers(ctx, me, input.memberIds),
    createdAt: ctx.now().toISOString(),
  }
  ctx.store.saveCircle(circle)
  return circle
}

export function updateCircle(ctx: Ctx, me: User, id: string, raw: unknown): Circle {
  const circle = ctx.store.getCircle(id)
  if (!circle) throw notFound('找不到圈子')
  if (circle.ownerId !== me.id) throw forbidden()
  const input = circleSchema.parse(raw)
  const next = { ...circle, name: input.name, memberIds: sanitizeMembers(ctx, me, input.memberIds) }
  ctx.store.saveCircle(next)
  return next
}

export function deleteCircle(ctx: Ctx, me: User, id: string) {
  const circle = ctx.store.getCircle(id)
  if (!circle) return
  if (circle.ownerId !== me.id) throw forbidden()
  ctx.store.deleteCircle(id)
}
