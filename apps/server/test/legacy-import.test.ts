import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LegacyStore } from '../src/legacy-store'
import { Store } from '../src/store'
import { importLegacy } from '../src/legacy-import'
import { signupGuest } from '../src/services/users'
import { createSpace } from '../src/services/spaces'
import { createEvent } from '../src/services/events'
const now = () => new Date('2026-10-23T15:00:00Z')
describe('旧数据隔离与显式迁移', () => {
  it('升级生成一致备份，不暴露旧活动；预览不加入成员，部分名单跳过整个活动，重复导入不覆盖', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onemore-import-')),
      path = join(dir, 'legacy.db')
    try {
      const legacy = new LegacyStore(path)
      const ctx = { store: legacy as Store, now }
      const a = signupGuest(ctx, { nickname: 'A', timezone: 'Asia/Shanghai' }).user
      const b = signupGuest(ctx, { nickname: 'B', timezone: 'Asia/Shanghai' }).user
      const c = signupGuest(ctx, { nickname: 'C', timezone: 'Asia/Shanghai' }).user
      const event = {
        id: 'old-event',
        code: 'oldcode',
        hostId: a.id,
        title: '旧局',
        note: '',
        mode: 'online',
        location: '',
        hostTimezone: a.timezone,
        options: [],
        slots: [],
        visibility: 'link',
        invitations: [{ userId: c.id, wave: 1, invitedAt: now().toISOString() }],
        allowWaitlist: true,
        status: 'open',
        final: null,
        cancelReason: '',
        sourceInterestId: null,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString(),
      } as const
      legacy.saveEvent(event as any)
      legacy.close()
      const store = new Store(path),
        context = { store, now }
      expect(readdirSync(dir).some((f) => f.includes('pre-spaces'))).toBe(true)
      const space = createSpace(context, a, { name: '新空间' }).space
      expect(store.forSpace(space.id).getEventByCode('oldcode')).toBeUndefined()
      expect(() => store.getEventByCode('oldcode')).toThrow('请先选择空间')
      const partial = importLegacy(store, space.id, [a.id, b.id], false, now)
      expect(partial.skipped.events).toBe(1)
      expect(store.getMembership(space.id, b.id)).toBeUndefined()
      const full = importLegacy(store, space.id, [a.id, b.id, c.id], false, now)
      expect(full.counts.events).toBe(1)
      expect(store.forSpace(space.id).getEventByCode('oldcode')).toBeUndefined()
      importLegacy(store, space.id, [a.id, b.id, c.id], true, now)
      expect(store.forSpace(space.id).getEventByCode('oldcode')?.title).toBe('旧局')
      expect(importLegacy(store, space.id, [a.id, b.id, c.id], true, now).alreadyImported).toBe(true)
      expect(store.forSpace(space.id).hasCalendarFeed(a.id)).toBe(false)
      store.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
