import { z } from 'zod'
import { deriveStatus, type Space, type SpaceJoinRequest, type User } from '@couju/core'
import type { Ctx } from './context'
import { badRequest, forbidden, hashToken, newId, newToken, notFound, toPublic } from '../util'
import { notify } from './notify'

export function requireMember(ctx: Ctx, user: User, id: string) {
  const membership = ctx.store.getMembership(id, user.id)
  if (!membership) throw forbidden('你还不是这个空间的成员')
  return membership
}
export function requireOwner(ctx: Ctx, user: User, id: string) {
  const m = requireMember(ctx, user, id)
  if (m.role !== 'owner') throw forbidden('只有空间管理员能操作')
  return m
}
export function createSpace(ctx: Ctx, user: User, raw: unknown) {
  const { name } = z.object({ name: z.string().trim().min(1, '请填写空间名称').max(30, '空间名称最多30字') }).parse(raw)
  if (ctx.store.listSpaces(user.id).length >= 20) throw badRequest('最多加入20个空间')
  return ctx.store.tx(() => {
    const space: Space = { id: newId('sp'), name, ownerId: user.id, createdAt: ctx.now().toISOString() }
    ctx.store.saveSpace(space)
    ctx.store.saveMembership({ spaceId: space.id, userId: user.id, role: 'owner', joinedAt: space.createdAt, emailEnabled: true })
    return { space }
  })
}
export function rotateInvite(ctx: Ctx, user: User, id: string) {
  requireOwner(ctx, user, id)
  const token = newToken()
  ctx.store.setInviteHash(id, hashToken(token))
  return { token, path: `/pages/spaces/index?invite=${token}` }
}
export function invitePreview(ctx: Ctx, token: string, user?: User) {
  const s = ctx.store.spaceFromInvite(hashToken(token))
  if (!s) throw notFound('邀请链接已失效')
  const request = user ? ctx.store.joinRequests(s.id).find((r) => r.userId === user.id) : undefined
  return {
    space: { id: s.id, name: s.name },
    status: user && ctx.store.getMembership(s.id, user.id) ? 'member' : (request?.status ?? null),
  }
}
export function requestJoin(ctx: Ctx, user: User, token: string) {
  const { space } = invitePreview(ctx, token, user)
  if (ctx.store.getMembership(space.id, user.id)) return { alreadyMember: true, request: null }
  return ctx.store.tx(() => {
    const old = ctx.store.joinRequests(space.id).find((r) => r.userId === user.id)
    if (old?.status === 'pending' || (old?.status === 'approved' && ctx.store.getMembership(space.id, user.id))) return { request: old }
    const request: SpaceJoinRequest = {
      id: old?.id ?? newId('jr'),
      spaceId: space.id,
      userId: user.id,
      status: 'pending',
      createdAt: ctx.now().toISOString(),
    }
    ctx.store.saveJoinRequest(request)
    return { request }
  })
}
export function decideRequest(ctx: Ctx, user: User, id: string, requestId: string, approve: boolean) {
  requireOwner(ctx, user, id)
  return ctx.store.tx(() => {
    const r = ctx.store.joinRequests(id).find((r) => r.id === requestId)
    if (!r) throw notFound('申请不存在')
    if (r.status !== 'pending') {
      if (approve && r.status === 'approved' && ctx.store.getMembership(id, r.userId)) return { ok: true }
      throw badRequest('申请已处理')
    }
    if (approve && !ctx.store.getMembership(id, r.userId)) {
      if (ctx.store.listSpaces(r.userId).length >= 20) throw badRequest('对方已加入20个空间')
      ctx.store.saveMembership({ spaceId: id, userId: r.userId, role: 'member', joinedAt: ctx.now().toISOString(), emailEnabled: true })
    }
    ctx.store.saveJoinRequest({ ...r, status: approve ? 'approved' : 'rejected' })
    return { ok: true }
  })
}
export function memberList(ctx: Ctx, user: User, id: string) {
  requireMember(ctx, user, id)
  return { members: ctx.store.members(id).map((m) => ({ ...m, user: toPublic(ctx.store.getUser(m.userId)!) })) }
}
export function requests(ctx: Ctx, user: User, id: string) {
  requireOwner(ctx, user, id)
  return {
    requests: ctx.store
      .joinRequests(id)
      .filter((r) => r.status === 'pending')
      .map((r) => ({ ...r, user: toPublic(ctx.store.getUser(r.userId)!) })),
  }
}
export function removeMember(ctx: Ctx, user: User, id: string, target: string) {
  if (target !== user.id) requireOwner(ctx, user, id)
  else requireMember(ctx, user, id)
  const member = ctx.store.getMembership(id, target)
  if (!member) return { ok: true }
  if (member.role === 'owner' || ctx.store.getSpace(id)?.ownerId === target) throw badRequest('管理员不能退出或移除自己')
  const scoped = { ...ctx, store: ctx.store.forSpace(id) }
  return ctx.store.tx(() => {
    const at = ctx.now().toISOString()
    for (const e of scoped.store.allEvents()) {
      const status = deriveStatus(e, ctx.now())
      if (status !== 'open' && status !== 'confirmed') continue
      if (e.hostId === target) {
        scoped.store.saveEvent({ ...e, status: 'cancelled', cancelReason: '组局人已退出空间', updatedAt: at })
        const recipients = new Set([...e.invitations.map((i) => i.userId), ...scoped.store.listResponses(e.id).map((r) => r.userId)])
        for (const uid of recipients)
          if (uid !== target)
            notify(scoped, uid, {
              kind: 'event_cancelled',
              title: `${e.title} 已取消`,
              body: '组局人已退出空间',
              link: `/pages/event/detail?code=${e.code}`,
              dedupeKey: `member-left:${e.id}:${target}`,
            })
      } else {
        const involved =
          e.invitations.some((i) => i.userId === target) ||
          !!scoped.store.getResponse(e.id, target) ||
          e.final?.rosterIds.includes(target) ||
          e.final?.waitlistIds.includes(target)
        if (!involved) continue
        scoped.store.deleteResponse(e.id, target)
        const final = e.final
          ? {
              ...e.final,
              rosterIds: e.final.rosterIds.filter((u) => u !== target),
              waitlistIds: e.final.waitlistIds.filter((u) => u !== target),
              roleAssignments: Object.fromEntries(
                Object.entries(e.final.roleAssignments).map(([k, ids]) => [k, ids.filter((u) => u !== target)]),
              ),
            }
          : null
        scoped.store.saveEvent({ ...e, invitations: e.invitations.filter((i) => i.userId !== target), final, updatedAt: at })
        notify(scoped, e.hostId, {
          kind: 'event_short',
          title: `${e.title} 有成员退出`,
          body: '该成员已退出空间，未来活动报名和席位已撤回，请检查人数。',
          link: `/pages/event/detail?code=${e.code}`,
          dedupeKey: `member-left:${e.id}:${target}`,
        })
      }
    }
    for (const i of scoped.store.listInterestsByStatus('active')) {
      const changed = i.ownerId === target || i.joiners.some((j) => j.userId === target)
      if (i.ownerId === target) scoped.store.saveInterest({ ...i, status: 'withdrawn' })
      else if (changed) scoped.store.saveInterest({ ...i, joiners: i.joiners.filter((j) => j.userId !== target) })
      if (changed)
        for (const uid of new Set([i.ownerId, ...i.joiners.map((j) => j.userId)]))
          if (uid !== target)
            notify(scoped, uid, {
              kind: 'interest_changed',
              objectId: i.id,
              title: `${i.name} 参与情况有变化`,
              body: i.ownerId === target ? '发起人已退出空间，这条想玩已撤回。' : '有成员退出空间，想玩人数已更新。',
              link: '/pages/index/index',
              dedupeKey: `interest-member-left:${i.id}:${target}`,
            })
    }
    scoped.store.clearMemberRecords(target)
    ctx.store.deleteMembership(id, target)
    // Queued messages are also rechecked at send time; cancel now for a clear local record.
    for (const m of ctx.store.listOutbox(100000))
      if (m.status === 'queued' && m.spaceId === id && m.recipientId === target)
        ctx.store.saveOutbox({ ...m, status: 'failed', lastError: 'membership_revoked' })
    return { ok: true }
  })
}
