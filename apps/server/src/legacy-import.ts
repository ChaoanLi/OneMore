import type { AppNotification, Circle, EventResponse, FriendPref, Friendship, GameEvent, Interest } from '@couju/core'
import type { Store } from './store'
import { badRequest, hashToken, notFound } from './util'

/** Local operator tool. No HTTP route exposes this legacy data or operation. */
export function importLegacy(store: Store, spaceId: string, memberIds: string[], apply = false, now = () => new Date()) {
  const space = store.getSpace(spaceId)
  if (!space) throw notFound('目标空间不存在')
  const ids = [...new Set(memberIds)].sort(),
    allowed = new Set(ids)
  if (!allowed.has(space.ownerId) || ids.some((id) => !store.getUser(id))) throw badRequest('名单必须包含目标空间管理员，且每个账号都存在')
  const key = hashToken(`legacy-v1:${ids.join(',')}`)
  const alreadyImported = !!store.db.prepare('SELECT 1 FROM space_imports WHERE source_key=? AND space_id=?').get(key, spaceId)
  const read = <T>(table: string): T[] =>
    (store.db.prepare(`SELECT data FROM ${table}`).all() as { data: string }[]).map((r) => JSON.parse(r.data))
  const allResponses = read<EventResponse>('responses'),
    rawEvents = read<GameEvent>('events'),
    rawInterests = read<Interest>('interests')
  const hasAll = (values: string[]) => values.every((id) => allowed.has(id))
  const circles = read<Circle>('circles').filter((c) => hasAll([c.ownerId, ...c.memberIds]))
  const circleIds = new Set(circles.map((c) => c.id))
  let events = rawEvents.filter((e) =>
    hasAll([
      e.hostId,
      ...e.invitations.map((i) => i.userId),
      ...allResponses.filter((r) => r.eventId === e.id).map((r) => r.userId),
      ...(e.final?.rosterIds ?? []),
      ...(e.final?.waitlistIds ?? []),
      ...Object.values(e.final?.roleAssignments ?? {}).flat(),
    ]),
  )
  let interests = rawInterests.filter(
    (i) =>
      hasAll([i.ownerId, ...i.joiners.map((j) => j.userId)]) &&
      (i.audience.kind !== 'circles' || i.audience.circleIds.every((id) => circleIds.has(id))),
  )
  // Conversion references are cyclic; retain only the closed subset of eligible objects.
  let changed = true
  while (changed) {
    const eids = new Set(events.map((e) => e.id)),
      iids = new Set(interests.map((i) => i.id)),
      count = events.length + interests.length
    events = events.filter((e) => !e.sourceInterestId || iids.has(e.sourceInterestId))
    interests = interests.filter((i) => !i.convertedEventId || eids.has(i.convertedEventId))
    changed = count !== events.length + interests.length
  }
  const eventIds = new Set(events.map((e) => e.id))
  const friends = read<Friendship>('friendships').filter((f) => hasAll([f.a, f.b]))
  const prefs = (
    store.db.prepare('SELECT owner_id,friend_id,favorite FROM friend_prefs').all() as {
      owner_id: string
      friend_id: string
      favorite: number
    }[]
  )
    .filter((p) => hasAll([p.owner_id, p.friend_id]))
    .map((p) => ({ ownerId: p.owner_id, friendId: p.friend_id, favorite: !!p.favorite }))
  const responses = allResponses.filter((r) => eventIds.has(r.eventId))
  const counts = {
    members: ids.filter((id) => !store.getMembership(spaceId, id)).length,
    events: events.length,
    interests: interests.length,
    circles: circles.length,
    friends: friends.length,
    responses: responses.length,
  }
  const skipped = { events: rawEvents.length - events.length, interests: rawInterests.length - interests.length }
  const result = {
    counts,
    skipped,
    alreadyImported,
    applied: false,
    reason: '不完整的成员名单或关联对象将整条跳过；旧通知、待发邮件和日历订阅不导入',
  }
  if (!apply || alreadyImported) return result
  const scoped = store.forSpace(spaceId)
  const records: [string, string, unknown][] = [
    ...friends.map((f) => ['friend', f.id, f] as [string, string, unknown]),
    ...prefs.map((p) => ['pref', `${p.ownerId}:${p.friendId}`, p] as [string, string, unknown]),
    ...circles.map((c) => ['circle', c.id, c] as [string, string, unknown]),
    ...events.map((e) => ['event', e.id, e] as [string, string, unknown]),
    ...responses.map((r) => ['response', `${r.eventId}:${r.userId}`, r] as [string, string, unknown]),
    ...interests.map((i) => ['interest', i.id, i] as [string, string, unknown]),
  ]
  for (const [kind, id] of records)
    if (store.db.prepare('SELECT 1 FROM space_records WHERE space_id=? AND kind=? AND id=?').get(spaceId, kind, id))
      throw badRequest('目标空间已有同 ID 数据；停止导入以避免覆盖')
  if (events.some((e) => scoped.getEventByCode(e.code))) throw badRequest('目标空间已有相同活动短码')
  const file = (store.db.prepare('PRAGMA database_list').all() as { name: string; file: string }[]).find((r) => r.name === 'main')?.file
  if (file) store.db.prepare('VACUUM INTO ?').run(`${file}.pre-import-${Date.now()}.bak`)
  store.tx(() => {
    for (const id of ids)
      if (!store.getMembership(spaceId, id))
        store.saveMembership({
          spaceId,
          userId: id,
          role: id === space.ownerId ? 'owner' : 'member',
          joinedAt: now().toISOString(),
          emailEnabled: true,
        })
    const put = store.db.prepare('INSERT INTO space_records(space_id,kind,id,data) VALUES(?,?,?,?)')
    for (const [kind, id, data] of records) put.run(spaceId, kind, id, JSON.stringify(data))
    store.db.prepare('INSERT INTO space_imports(source_key,space_id,created_at) VALUES(?,?,?)').run(key, spaceId, now().toISOString())
  })
  return { ...result, applied: true }
}
