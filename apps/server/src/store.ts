import { existsSync } from 'node:fs'
import type { DatabaseSync } from 'node:sqlite'
import type {
  AppNotification,
  Circle,
  EventResponse,
  FriendPref,
  Friendship,
  GameEvent,
  Interest,
  Membership,
  Space,
  SpaceJoinRequest,
  SpaceSummary,
  UserId,
} from '@couju/core'
import { LegacyStore } from './legacy-store'
import { badRequest, notFound, newId } from './util'
export type { UserEmailRecord, OutboxEmail } from './legacy-store'

/** Global identity plus immutable space repository. Legacy business tables are never queried here. */
export class Store extends LegacyStore {
  readonly spaceId?: string
  private readonly ownsConnection: boolean
  constructor(path = ':memory:', connection?: DatabaseSync, spaceId?: string) {
    const existing = !connection && path !== ':memory:' && existsSync(path)
    super(path, connection)
    this.ownsConnection = !connection
    this.spaceId = spaceId
    if (connection) return
    if (existing && !this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='spaces'").get()) {
      // VACUUM INTO produces a consistent snapshot including WAL contents.
      this.db.prepare('VACUUM INTO ?').run(`${path}.pre-spaces-${Date.now()}.bak`)
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL, invite_hash TEXT UNIQUE);
      CREATE TABLE IF NOT EXISTS space_members (space_id TEXT NOT NULL REFERENCES spaces(id), user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, PRIMARY KEY(space_id,user_id));
      CREATE TABLE IF NOT EXISTS space_requests (id TEXT PRIMARY KEY, space_id TEXT NOT NULL REFERENCES spaces(id), user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL, UNIQUE(space_id,user_id));
      CREATE TABLE IF NOT EXISTS space_records (space_id TEXT NOT NULL REFERENCES spaces(id), kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(space_id,kind,id));
      CREATE INDEX IF NOT EXISTS space_records_kind ON space_records(space_id,kind);
      CREATE TABLE IF NOT EXISTS space_imports (source_key TEXT NOT NULL, space_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(source_key,space_id));
    `)
    this.db.exec(
      "UPDATE space_members SET data=json_set(data,'$.generation',lower(hex(randomblob(16)))) WHERE json_extract(data,'$.generation') IS NULL",
    )
  }
  forSpace(spaceId: string): Store {
    if (!this.getSpace(spaceId)) throw notFound('空间不存在')
    return new Store(':memory:', this.db, spaceId)
  }
  private scope(): string {
    if (!this.spaceId) throw badRequest('请先选择空间', 'space_required')
    return this.spaceId
  }
  private records<T>(kind: string): T[] {
    return (
      this.db.prepare('SELECT data FROM space_records WHERE space_id=? AND kind=?').all(this.scope(), kind) as { data: string }[]
    ).map((r) => JSON.parse(r.data))
  }
  private record<T>(kind: string, id: string): T | undefined {
    const r = this.db.prepare('SELECT data FROM space_records WHERE space_id=? AND kind=? AND id=?').get(this.scope(), kind, id) as
      | { data: string }
      | undefined
    return r ? JSON.parse(r.data) : undefined
  }
  private put(kind: string, id: string, value: unknown) {
    this.db
      .prepare(
        'INSERT INTO space_records(space_id,kind,id,data) VALUES(?,?,?,?) ON CONFLICT(space_id,kind,id) DO UPDATE SET data=excluded.data',
      )
      .run(this.scope(), kind, id, JSON.stringify(value))
  }
  private del(kind: string, id: string) {
    this.db.prepare('DELETE FROM space_records WHERE space_id=? AND kind=? AND id=?').run(this.scope(), kind, id)
  }
  getSpace(id: string): Space | undefined {
    const r = this.db.prepare('SELECT data FROM spaces WHERE id=?').get(id) as { data: string } | undefined
    return r ? JSON.parse(r.data) : undefined
  }
  allSpaces(): Space[] {
    return (this.db.prepare('SELECT data FROM spaces').all() as { data: string }[]).map((r) => JSON.parse(r.data))
  }
  saveSpace(s: Space) {
    this.db.prepare('INSERT INTO spaces(id,owner_id,data) VALUES(?,?,?)').run(s.id, s.ownerId, JSON.stringify(s))
  }
  listSpaces(userId: string): SpaceSummary[] {
    return this.allSpaces().flatMap((s) => {
      const m = this.getMembership(s.id, userId)
      return m ? [{ ...s, role: m.role }] : []
    })
  }
  getMembership(spaceId: string, userId: string): Membership | undefined {
    const r = this.db.prepare('SELECT data FROM space_members WHERE space_id=? AND user_id=?').get(spaceId, userId) as
      | { data: string }
      | undefined
    return r ? JSON.parse(r.data) : undefined
  }
  members(spaceId = this.scope()): Membership[] {
    return (this.db.prepare('SELECT data FROM space_members WHERE space_id=?').all(spaceId) as { data: string }[]).map((r) =>
      JSON.parse(r.data),
    )
  }
  saveMembership(input: Omit<Membership, 'generation'> & { generation?: string }) {
    const m: Membership = {
      ...input,
      generation: input.generation ?? this.getMembership(input.spaceId, input.userId)?.generation ?? newId('membership'),
    }
    this.db
      .prepare(
        'INSERT INTO space_members(space_id,user_id,data) VALUES(?,?,?) ON CONFLICT(space_id,user_id) DO UPDATE SET data=excluded.data',
      )
      .run(m.spaceId, m.userId, JSON.stringify(m))
  }
  deleteMembership(spaceId: string, userId: string) {
    this.db.prepare('DELETE FROM space_members WHERE space_id=? AND user_id=?').run(spaceId, userId)
  }
  isMember(userId: string) {
    return !!this.getMembership(this.scope(), userId)
  }
  assertMembers(ids: string[]) {
    if (ids.some((id) => !this.isMember(id))) throw badRequest('只能选择当前空间的成员')
  }
  setInviteHash(spaceId: string, hash: string) {
    this.db.prepare('UPDATE spaces SET invite_hash=? WHERE id=?').run(hash, spaceId)
  }
  spaceFromInvite(hash: string): Space | undefined {
    const r = this.db.prepare('SELECT data FROM spaces WHERE invite_hash=?').get(hash) as { data: string } | undefined
    return r ? JSON.parse(r.data) : undefined
  }
  joinRequests(spaceId: string): SpaceJoinRequest[] {
    return (this.db.prepare('SELECT data FROM space_requests WHERE space_id=?').all(spaceId) as { data: string }[]).map((r) =>
      JSON.parse(r.data),
    )
  }
  saveJoinRequest(r: SpaceJoinRequest) {
    this.db
      .prepare(
        'INSERT INTO space_requests(id,space_id,user_id,data) VALUES(?,?,?,?) ON CONFLICT(space_id,user_id) DO UPDATE SET data=excluded.data',
      )
      .run(r.id, r.spaceId, r.userId, JSON.stringify(r))
  }

  override getFriendship(x: string, y: string) {
    return this.records<Friendship>('friend').find((f) => (f.a === x && f.b === y) || (f.a === y && f.b === x))
  }
  override saveFriendship(f: Friendship) {
    this.assertMembers([f.a, f.b])
    this.put('friend', f.id, f)
  }
  override deleteFriendship(id: string) {
    this.del('friend', id)
  }
  override listFriendships(userId: string) {
    return this.records<Friendship>('friend').filter((f) => (f.a === userId || f.b === userId) && this.isMember(f.a) && this.isMember(f.b))
  }
  override getPrefs(ownerId: string) {
    return this.records<FriendPref>('pref').filter((p) => p.ownerId === ownerId)
  }
  override setPref(p: FriendPref) {
    this.assertMembers([p.ownerId, p.friendId])
    this.put('pref', `${p.ownerId}:${p.friendId}`, p)
  }
  override deletePref(ownerId: string, friendId: string) {
    this.del('pref', `${ownerId}:${friendId}`)
  }
  override listCircles(ownerId: string) {
    return this.records<Circle>('circle').filter((c) => c.ownerId === ownerId)
  }
  override getCircle(id: string) {
    return this.record<Circle>('circle', id)
  }
  override saveCircle(c: Circle) {
    this.assertMembers([c.ownerId, ...c.memberIds])
    this.put('circle', c.id, c)
  }
  override deleteCircle(id: string) {
    this.del('circle', id)
  }
  override getEventByCode(code: string) {
    return this.records<GameEvent>('event').find((e) => e.code === code)
  }
  override getEvent(id: string) {
    return this.record<GameEvent>('event', id)
  }
  override saveEvent(e: GameEvent) {
    this.put('event', e.id, e)
  }
  allEvents() {
    return this.records<GameEvent>('event')
  }
  override listEventsForUser(userId: string) {
    return this.allEvents()
      .filter((e) => e.hostId === userId || e.invitations.some((i) => i.userId === userId) || !!this.getResponse(e.id, userId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 100)
  }
  override getResponse(eventId: string, userId: string) {
    return this.record<EventResponse>('response', `${eventId}:${userId}`)
  }
  override listResponses(eventId: string) {
    return this.records<EventResponse>('response').filter((r) => r.eventId === eventId)
  }
  override saveResponse(r: EventResponse) {
    if (!this.getEvent(r.eventId)) throw notFound('活动不存在')
    this.assertMembers([r.userId])
    this.put('response', `${r.eventId}:${r.userId}`, r)
  }
  deleteResponse(eventId: string, userId: string) {
    this.del('response', `${eventId}:${userId}`)
  }
  override getInterest(id: string) {
    return this.record<Interest>('interest', id)
  }
  override saveInterest(i: Interest) {
    this.put('interest', i.id, i)
  }
  override listInterestsByStatus(status: Interest['status']) {
    return this.records<Interest>('interest').filter((i) => i.status === status)
  }
  override listInterestsByOwners(ownerIds: string[]) {
    return this.records<Interest>('interest').filter((i) => ownerIds.includes(i.ownerId))
  }
  override saveNotification(n: AppNotification) {
    if (this.isMember(n.userId)) this.put('notification', n.id, n)
  }
  override listNotifications(userId: string, sinceIso?: string, limit = 50) {
    return this.records<AppNotification>('notification')
      .reverse()
      .filter((n) => n.userId === userId && (!sinceIso || n.createdAt >= sinceIso))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, sinceIso ? undefined : limit)
  }
  override markAllRead(userId: string, at: string) {
    for (const n of this.records<AppNotification>('notification').filter((n) => n.userId === userId))
      if (!n.readAt) this.saveNotification({ ...n, readAt: at })
  }
  override unreadCount(userId: string) {
    return this.records<AppNotification>('notification').filter((n) => n.userId === userId && !n.readAt).length
  }
  override setCalendarFeed(userId: string, tokenHash: string, createdAt: string) {
    this.assertMembers([userId])
    this.put('feed', userId, { userId, tokenHash, createdAt })
  }
  override getCalendarFeedUser(tokenHash: string) {
    return this.records<{ userId: string; tokenHash: string }>('feed').find((f) => f.tokenHash === tokenHash && this.isMember(f.userId))
      ?.userId
  }
  resolveCalendarFeed(tokenHash: string): { spaceId: string; userId: string } | undefined {
    const rows = this.db
      .prepare("SELECT space_id,data FROM space_records WHERE kind='feed' AND json_extract(data,'$.tokenHash')=?")
      .all(tokenHash) as { space_id: string; data: string }[]
    for (const r of rows) {
      const f = JSON.parse(r.data)
      if (this.getMembership(r.space_id, f.userId)) return { spaceId: r.space_id, userId: f.userId }
    }
  }
  override hasCalendarFeed(userId: string) {
    return !!this.record('feed', userId)
  }
  override deleteCalendarFeed(userId: string) {
    this.del('feed', userId)
  }
  override logEmailInvite(hostId: string, email: string, eventId: string, at: string) {
    this.put('email_invite', `${hostId}:${email}:${eventId}:${at}`, { hostId, email, eventId, at })
  }
  override countEmailInvites(hostId: string, since: string, email?: string) {
    return this.records<{ hostId: string; email: string; at: string }>('email_invite').filter(
      (r) => r.hostId === hostId && r.at >= since && (!email || r.email === email),
    ).length
  }
  override countEmailToAddress(email: string, since: string) {
    return this.records<{ email: string; at: string }>('email_invite').filter((r) => r.email === email && r.at >= since).length
  }
  clearMemberRecords(userId: string) {
    for (const f of this.listFriendships(userId)) this.deleteFriendship(f.id)
    for (const p of this.records<FriendPref>('pref'))
      if (p.ownerId === userId || p.friendId === userId) this.deletePref(p.ownerId, p.friendId)
    for (const c of this.records<Circle>('circle')) {
      if (c.ownerId === userId) this.deleteCircle(c.id)
      else if (c.memberIds.includes(userId)) this.saveCircle({ ...c, memberIds: c.memberIds.filter((id) => id !== userId) })
    }
    for (const n of this.records<AppNotification>('notification')) if (n.userId === userId) this.del('notification', n.id)
    this.deleteCalendarFeed(userId)
  }
  override close() {
    if (this.ownsConnection) super.close()
  }
}
