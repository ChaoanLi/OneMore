import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  AppNotification,
  Circle,
  EventResponse,
  FriendPref,
  Friendship,
  GameEvent,
  Interest,
  User,
  UserId,
} from '@couju/core'

/** 用户邮箱（私密，只有本人能看到） */
export interface UserEmailRecord {
  userId: UserId
  /** 已验证的邮箱 */
  email: string | null
  enabled: boolean
  verifiedAt: string | null
  pendingEmail: string | null
  codeHash: string | null
  codeExpiresAt: string | null
  codeAttempts: number
  /** 最近发送验证码的时间，用于限频 */
  codeSentAt: string[]
}

export interface OutboxEmail {
  id: string
  to: string
  subject: string
  text: string
  html: string
  headers: Record<string, string>
  status: 'queued' | 'sent' | 'failed'
  sendAfter: string
  attempts: number
  lastError: string | null
  kind: string
  createdAt: string
  sentAt: string | null
}

/**
 * 数据访问层（Repository）。
 *
 * 本地/自托管使用 Node 内置 SQLite（node:sqlite，无需原生编译）。
 * 每张表 = 文档 JSON + 少量索引列，结构上对齐 CloudBase 文档型数据库，
 * 将来替换为 CloudBase 适配器时只需实现同样的方法（见 README “CloudBase 迁移”）。
 */
export class Store {
  readonly db: DatabaseSync

  constructor(path: string = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')
    this.migrate()
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, handle TEXT NOT NULL UNIQUE, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS recovery (user_id TEXT PRIMARY KEY, code_hash TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS friendships (id TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL, UNIQUE(a, b));
      CREATE INDEX IF NOT EXISTS friendships_a ON friendships(a);
      CREATE INDEX IF NOT EXISTS friendships_b ON friendships(b);
      CREATE TABLE IF NOT EXISTS friend_prefs (owner_id TEXT NOT NULL, friend_id TEXT NOT NULL, favorite INTEGER NOT NULL, PRIMARY KEY (owner_id, friend_id));
      CREATE TABLE IF NOT EXISTS circles (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS circles_owner ON circles(owner_id);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, code TEXT NOT NULL UNIQUE, host_id TEXT NOT NULL, updated_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_host ON events(host_id);
      CREATE TABLE IF NOT EXISTS event_invites (event_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY (event_id, user_id));
      CREATE INDEX IF NOT EXISTS event_invites_user ON event_invites(user_id);
      CREATE TABLE IF NOT EXISTS responses (event_id TEXT NOT NULL, user_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (event_id, user_id));
      CREATE INDEX IF NOT EXISTS responses_user ON responses(user_id);
      CREATE TABLE IF NOT EXISTS interests (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS interests_status ON interests(status);
      CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS notifications_user ON notifications(user_id, created_at);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_emails (user_id TEXT PRIMARY KEY, email TEXT, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS user_emails_email ON user_emails(email);
      CREATE TABLE IF NOT EXISTS email_outbox (id TEXT PRIMARY KEY, status TEXT NOT NULL, send_after TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS email_outbox_due ON email_outbox(status, send_after);
      CREATE TABLE IF NOT EXISTS email_suppressions (email TEXT PRIMARY KEY, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS email_unsub (token TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE);
      CREATE TABLE IF NOT EXISTS email_invites (host_id TEXT NOT NULL, email TEXT NOT NULL, event_id TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS email_invites_host ON email_invites(host_id, created_at);
      CREATE TABLE IF NOT EXISTS calendar_feeds (user_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
    `)
  }

  /** 同步事务：node:sqlite 是同步 API，单进程内天然串行。 */
  tx<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const out = fn()
      this.db.exec('COMMIT')
      return out
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }

  private one<T>(sql: string, ...params: (string | number | null)[]): T | undefined {
    const row = this.db.prepare(sql).get(...params) as { data: string } | undefined
    return row ? (JSON.parse(row.data) as T) : undefined
  }

  private many<T>(sql: string, ...params: (string | number | null)[]): T[] {
    return (this.db.prepare(sql).all(...params) as { data: string }[]).map((r) => JSON.parse(r.data) as T)
  }

  nextSeq(name: string): number {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(`seq:${name}`) as { value: string } | undefined
    const next = (row ? Number(row.value) : 0) + 1
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(`seq:${name}`, String(next))
    return next
  }

  // ---------- users & sessions ----------

  getUser(id: UserId): User | undefined {
    return this.one<User>('SELECT data FROM users WHERE id = ?', id)
  }
  getUserByHandle(handle: string): User | undefined {
    return this.one<User>('SELECT data FROM users WHERE handle = ?', handle.toLowerCase())
  }
  getUsers(ids: UserId[]): User[] {
    if (ids.length === 0) return []
    const unique = [...new Set(ids)]
    return this.many<User>(`SELECT data FROM users WHERE id IN (${unique.map(() => '?').join(',')})`, ...unique)
  }
  saveUser(user: User) {
    this.db
      .prepare('INSERT INTO users (id, handle, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET handle = excluded.handle, data = excluded.data')
      .run(user.id, user.handle, JSON.stringify(user))
  }
  createSession(tokenHash: string, userId: UserId, createdAt: string) {
    this.db.prepare('INSERT INTO sessions (token_hash, user_id, created_at) VALUES (?, ?, ?)').run(tokenHash, userId, createdAt)
  }
  getSessionUserId(tokenHash: string): UserId | undefined {
    const row = this.db.prepare('SELECT user_id FROM sessions WHERE token_hash = ?').get(tokenHash) as { user_id: string } | undefined
    return row?.user_id
  }
  setRecovery(userId: UserId, codeHash: string, createdAt: string) {
    this.db
      .prepare('INSERT INTO recovery (user_id, code_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at')
      .run(userId, codeHash, createdAt)
  }
  getRecoveryHash(userId: UserId): string | undefined {
    const row = this.db.prepare('SELECT code_hash FROM recovery WHERE user_id = ?').get(userId) as { code_hash: string } | undefined
    return row?.code_hash
  }

  // ---------- friends ----------

  getFriendship(x: UserId, y: UserId): Friendship | undefined {
    const [a, b] = x < y ? [x, y] : [y, x]
    return this.one<Friendship>('SELECT data FROM friendships WHERE a = ? AND b = ?', a, b)
  }
  saveFriendship(f: Friendship) {
    this.db
      .prepare('INSERT INTO friendships (id, a, b, status, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data')
      .run(f.id, f.a, f.b, f.status, JSON.stringify(f))
  }
  deleteFriendship(id: string) {
    this.db.prepare('DELETE FROM friendships WHERE id = ?').run(id)
  }
  listFriendships(userId: UserId): Friendship[] {
    return this.many<Friendship>('SELECT data FROM friendships WHERE a = ? OR b = ?', userId, userId)
  }
  friendIds(userId: UserId): UserId[] {
    return this.listFriendships(userId)
      .filter((f) => f.status === 'accepted')
      .map((f) => (f.a === userId ? f.b : f.a))
  }
  getPrefs(ownerId: UserId): FriendPref[] {
    return (this.db.prepare('SELECT owner_id, friend_id, favorite FROM friend_prefs WHERE owner_id = ?').all(ownerId) as {
      owner_id: string
      friend_id: string
      favorite: number
    }[]).map((r) => ({ ownerId: r.owner_id, friendId: r.friend_id, favorite: r.favorite === 1 }))
  }
  setPref(p: FriendPref) {
    this.db
      .prepare('INSERT INTO friend_prefs (owner_id, friend_id, favorite) VALUES (?, ?, ?) ON CONFLICT(owner_id, friend_id) DO UPDATE SET favorite = excluded.favorite')
      .run(p.ownerId, p.friendId, p.favorite ? 1 : 0)
  }
  deletePref(ownerId: UserId, friendId: UserId) {
    this.db.prepare('DELETE FROM friend_prefs WHERE owner_id = ? AND friend_id = ?').run(ownerId, friendId)
  }

  // ---------- circles ----------

  listCircles(ownerId: UserId): Circle[] {
    return this.many<Circle>('SELECT data FROM circles WHERE owner_id = ?', ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  getCircle(id: string): Circle | undefined {
    return this.one<Circle>('SELECT data FROM circles WHERE id = ?', id)
  }
  saveCircle(c: Circle) {
    this.db
      .prepare('INSERT INTO circles (id, owner_id, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data')
      .run(c.id, c.ownerId, JSON.stringify(c))
  }
  deleteCircle(id: string) {
    this.db.prepare('DELETE FROM circles WHERE id = ?').run(id)
  }

  // ---------- events ----------

  getEventByCode(code: string): GameEvent | undefined {
    return this.one<GameEvent>('SELECT data FROM events WHERE code = ?', code)
  }
  getEvent(id: string): GameEvent | undefined {
    return this.one<GameEvent>('SELECT data FROM events WHERE id = ?', id)
  }
  saveEvent(e: GameEvent) {
    this.db
      .prepare(
        'INSERT INTO events (id, code, host_id, updated_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, data = excluded.data',
      )
      .run(e.id, e.code, e.hostId, e.updatedAt, JSON.stringify(e))
    const ins = this.db.prepare('INSERT OR IGNORE INTO event_invites (event_id, user_id) VALUES (?, ?)')
    for (const inv of e.invitations) ins.run(e.id, inv.userId)
  }
  /** 与某用户相关的活动：发起的、被邀请的、回应过的 */
  listEventsForUser(userId: UserId): GameEvent[] {
    return this.many<GameEvent>(
      `SELECT data FROM events WHERE host_id = ?
       OR id IN (SELECT event_id FROM event_invites WHERE user_id = ?)
       OR id IN (SELECT event_id FROM responses WHERE user_id = ?)
       ORDER BY updated_at DESC LIMIT 100`,
      userId,
      userId,
      userId,
    )
  }

  // ---------- responses ----------

  getResponse(eventId: string, userId: UserId): EventResponse | undefined {
    return this.one<EventResponse>('SELECT data FROM responses WHERE event_id = ? AND user_id = ?', eventId, userId)
  }
  listResponses(eventId: string): EventResponse[] {
    return this.many<EventResponse>('SELECT data FROM responses WHERE event_id = ?', eventId)
  }
  saveResponse(r: EventResponse) {
    this.db
      .prepare('INSERT INTO responses (event_id, user_id, data) VALUES (?, ?, ?) ON CONFLICT(event_id, user_id) DO UPDATE SET data = excluded.data')
      .run(r.eventId, r.userId, JSON.stringify(r))
  }

  // ---------- interests ----------

  getInterest(id: string): Interest | undefined {
    return this.one<Interest>('SELECT data FROM interests WHERE id = ?', id)
  }
  saveInterest(i: Interest) {
    this.db
      .prepare('INSERT INTO interests (id, owner_id, status, data) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET status = excluded.status, data = excluded.data')
      .run(i.id, i.ownerId, i.status, JSON.stringify(i))
  }
  listInterestsByStatus(status: Interest['status']): Interest[] {
    return this.many<Interest>('SELECT data FROM interests WHERE status = ?', status)
  }
  listInterestsByOwners(ownerIds: UserId[]): Interest[] {
    if (ownerIds.length === 0) return []
    return this.many<Interest>(`SELECT data FROM interests WHERE owner_id IN (${ownerIds.map(() => '?').join(',')})`, ...ownerIds)
  }

  // ---------- notifications ----------

  saveNotification(n: AppNotification) {
    this.db
      .prepare(
        'INSERT INTO notifications (id, user_id, created_at, read_at, data) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET read_at = excluded.read_at, data = excluded.data',
      )
      .run(n.id, n.userId, n.createdAt, n.readAt, JSON.stringify(n))
  }
  listNotifications(userId: UserId, sinceIso?: string, limit = 50): AppNotification[] {
    if (sinceIso) {
      return this.many<AppNotification>(
        'SELECT data FROM notifications WHERE user_id = ? AND created_at >= ? ORDER BY created_at DESC',
        userId,
        sinceIso,
      )
    }
    return this.many<AppNotification>('SELECT data FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?', userId, limit)
  }
  markAllRead(userId: UserId, at: string) {
    const unread = this.many<AppNotification>('SELECT data FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)
    for (const n of unread) this.saveNotification({ ...n, readAt: at })
  }
  unreadCount(userId: UserId): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { c: number }
    return row.c
  }

  // ---------- 邮件 ----------

  getUserEmail(userId: UserId): UserEmailRecord | undefined {
    return this.one<UserEmailRecord>('SELECT data FROM user_emails WHERE user_id = ?', userId)
  }
  saveUserEmail(r: UserEmailRecord) {
    this.db
      .prepare('INSERT INTO user_emails (user_id, email, data) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email = excluded.email, data = excluded.data')
      .run(r.userId, r.email, JSON.stringify(r))
  }
  deleteUserEmail(userId: UserId) {
    this.db.prepare('DELETE FROM user_emails WHERE user_id = ?').run(userId)
  }
  findUserEmailsByAddress(email: string): UserEmailRecord[] {
    return this.many<UserEmailRecord>('SELECT data FROM user_emails WHERE email = ?', email)
  }
  enqueueEmail(m: OutboxEmail) {
    this.db.prepare('INSERT INTO email_outbox (id, status, send_after, data) VALUES (?, ?, ?, ?)').run(m.id, m.status, m.sendAfter, JSON.stringify(m))
  }
  saveOutbox(m: OutboxEmail) {
    this.db.prepare('UPDATE email_outbox SET status = ?, send_after = ?, data = ? WHERE id = ?').run(m.status, m.sendAfter, JSON.stringify(m), m.id)
  }
  dueEmails(nowIso: string, limit = 20): OutboxEmail[] {
    return this.many<OutboxEmail>("SELECT data FROM email_outbox WHERE status = 'queued' AND send_after <= ? ORDER BY send_after LIMIT ?", nowIso, limit)
  }
  listOutbox(limit = 50): OutboxEmail[] {
    return this.many<OutboxEmail>('SELECT data FROM email_outbox ORDER BY send_after DESC LIMIT ?', limit)
  }
  isSuppressed(email: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM email_suppressions WHERE email = ?').get(email)
  }
  suppress(email: string, at: string) {
    this.db.prepare('INSERT OR IGNORE INTO email_suppressions (email, created_at) VALUES (?, ?)').run(email, at)
  }
  unsuppress(email: string) {
    this.db.prepare('DELETE FROM email_suppressions WHERE email = ?').run(email)
  }
  unsubToken(email: string, fresh: () => string): string {
    const row = this.db.prepare('SELECT token FROM email_unsub WHERE email = ?').get(email) as { token: string } | undefined
    if (row) return row.token
    const token = fresh()
    this.db.prepare('INSERT INTO email_unsub (token, email) VALUES (?, ?)').run(token, email)
    return token
  }
  emailForUnsubToken(token: string): string | undefined {
    const row = this.db.prepare('SELECT email FROM email_unsub WHERE token = ?').get(token) as { email: string } | undefined
    return row?.email
  }
  logEmailInvite(hostId: UserId, email: string, eventId: string, at: string) {
    this.db.prepare('INSERT INTO email_invites (host_id, email, event_id, created_at) VALUES (?, ?, ?, ?)').run(hostId, email, eventId, at)
  }
  countEmailInvites(hostId: UserId, sinceIso: string, email?: string): number {
    const row = email
      ? (this.db.prepare('SELECT COUNT(*) AS c FROM email_invites WHERE host_id = ? AND created_at >= ? AND email = ?').get(hostId, sinceIso, email) as { c: number })
      : (this.db.prepare('SELECT COUNT(*) AS c FROM email_invites WHERE host_id = ? AND created_at >= ?').get(hostId, sinceIso) as { c: number })
    return row.c
  }
  countEmailToAddress(email: string, sinceIso: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM email_invites WHERE email = ? AND created_at >= ?').get(email, sinceIso) as { c: number }
    return row.c
  }

  // ---------- 日历订阅 ----------

  setCalendarFeed(userId: UserId, tokenHash: string, createdAt: string) {
    this.db
      .prepare('INSERT INTO calendar_feeds (user_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at')
      .run(userId, tokenHash, createdAt)
  }
  getCalendarFeedUser(tokenHash: string): UserId | undefined {
    const row = this.db.prepare('SELECT user_id FROM calendar_feeds WHERE token_hash = ?').get(tokenHash) as { user_id: string } | undefined
    return row?.user_id
  }
  hasCalendarFeed(userId: UserId): boolean {
    return !!this.db.prepare('SELECT 1 FROM calendar_feeds WHERE user_id = ?').get(userId)
  }
  deleteCalendarFeed(userId: UserId) {
    this.db.prepare('DELETE FROM calendar_feeds WHERE user_id = ?').run(userId)
  }

  close() {
    this.db.close()
  }
}
