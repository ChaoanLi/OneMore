import type { Interest, UserId } from './types'

/** “我想玩”：表达兴趣，不承担组织责任。人数够了可以由任何参与者转为正式活动。 */

export function interestHeadcount(interest: Pick<Interest, 'joiners'>): number {
  return 1 + interest.joiners.length
}

export function interestReady(interest: Pick<Interest, 'joiners' | 'minPlayers'>): boolean {
  return interestHeadcount(interest) >= interest.minPlayers
}

export function interestStillNeed(interest: Pick<Interest, 'joiners' | 'minPlayers'>): number {
  return Math.max(0, interest.minPlayers - interestHeadcount(interest))
}

export function isInterestExpired(interest: Pick<Interest, 'expiresAt' | 'status'>, now: Date = new Date()): boolean {
  return interest.status === 'active' && Date.parse(interest.expiresAt) <= now.getTime()
}

export function interestParticipants(interest: Pick<Interest, 'ownerId' | 'joiners'>): UserId[] {
  return [interest.ownerId, ...interest.joiners.map((j) => j.userId)]
}

/**
 * 某个好友是否能看到这条“想玩”。
 * ctx 由服务端根据发起者的私密好友数据计算，不会返回给客户端。
 */
export function interestVisibleTo(
  interest: Pick<Interest, 'ownerId' | 'audience'>,
  viewerId: UserId,
  ctx: { ownerFriendIds: Set<UserId>; ownerFavoriteIds: Set<UserId>; circleMemberIds: Set<UserId> },
): boolean {
  if (viewerId === interest.ownerId) return true
  if (!ctx.ownerFriendIds.has(viewerId)) return false
  switch (interest.audience.kind) {
    case 'friends':
      return true
    case 'favorites':
      return ctx.ownerFavoriteIds.has(viewerId)
    case 'circles':
      return ctx.circleMemberIds.has(viewerId)
  }
}
