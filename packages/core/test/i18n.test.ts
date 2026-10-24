import { describe, expect, it } from 'vitest'
import * as core from '../src/index'

const now = new Date('2026-10-23T15:00:00Z')
const slot = { startUtc: '2026-10-25T01:00:00Z', endUtc: '2026-10-25T03:00:00Z' }

describe('explicit locale formatting', () => {
  it('renders English status and progress while retaining Chinese defaults', () => {
    expect(core.statusText('open', 'en')).toBe('Looking for players')
    expect(core.statusText('open')).toBe('招人中')
    expect(
      core.describeProgress({ feasible: false, stillNeed: 2, missingRoles: [{ key: 'gm', label: 'KP/GM', need: 1 }], full: false }, 'en'),
    ).toBe('Still needed: 2 (requires 1 KP/GM)')
  })
  it('formats weekdays, next-day offsets and DST independently of locale', () => {
    expect(core.formatSlot(slot, 'America/Chicago', now, 'en').dateLabel).toBe('10/24 Sat')
    expect(core.slotInOtherZone(slot, 'America/Chicago', 'Asia/Shanghai', 'en')).toBe('Beijing time 10/25 Sun 09:00 (+1 day)')
    expect(core.formatSlot({ startUtc: '2026-11-01T07:30:00Z', endUtc: null }, 'America/Chicago', now, 'en').zoneAbbr).toBe('CST')
    expect(core.formatSlot({ startUtc: '2026-11-01T06:30:00Z', endUtc: null }, 'America/Chicago', now, 'en').zoneAbbr).toBe('CDT')
    expect(
      core.formatSlot({ startUtc: '2026-10-24T04:00:00Z', endUtc: '2026-10-24T06:00:00Z' }, 'America/Chicago', now, 'en').timeLabel,
    ).toBe('23:00–01:00 (next day)')
  })
  it('normalizes request languages and formats indexed arguments without interpreting content', () => {
    expect(core.normalizeLocale('en-US,en;q=0.9')).toBe('en')
    expect(core.normalizeLocale('zh-TW')).toBe('zh-CN')
    expect(core.normalizeLocale()).toBe('zh-CN')
    expect(core.normalizeLocale('de-DE')).toBe('en')
    expect(core.formatMessage('{0} / {0} / {1}', ['$& {1}', 'Alice'])).toBe('$& {1} / $& {1} / Alice')
    const msg = core.message('{0} 想加你为好友', '日麻')
    expect(core.renderMessage('en', msg)).toBe('日麻 wants to add you as a friend')
  })
  it('localizes built-in names and preserves custom names even with a catalog key', () => {
    expect(core.localizeBuiltinGame({ name: '日麻', gameKey: 'riichi' }, 'en').name).toBe('Riichi mahjong')
    expect(core.localizeBuiltinGame({ name: '我们的日麻', gameKey: 'riichi' }, 'en').name).toBe('我们的日麻')
    expect(core.localizeBuiltinGame({ name: 'Riichi mahjong', gameKey: 'riichi' }, 'zh-CN').name).toBe('日麻')
  })
  it('parses English time, headcount, invitation and role patterns into editable drafts', () => {
    const ctx = { now, timezone: 'America/Chicago', locale: 'en' as const }
    const draft = core.mockParseDraft('TRPG tomorrow evening with 4 players and a GM, invite all friends online', ctx)
    expect(draft.options[0]?.name).toBe('TRPG')
    expect(draft.when).toBe('tomorrow')
    expect(draft.timeOfDay).toBe('evening')
    expect(draft.headcount.min).toBe(4)
    expect(draft.invite.strategy).toBe('friends')
    expect(core.expandDraft(draft, ctx).options[0]?.roles).toEqual([{ key: 'gm', label: 'KP/GM', min: 1 }])
    expect(core.expandDraft(draft, ctx).title).toBe('Tomorrow TRPG')
    expect(core.mockParseDraft('Riichi next weekend', ctx).when).toBe('next_weekend')
    expect(core.mockParseDraft('board games on upcoming weekends', ctx).when).toBe('next_month_weekends')
  })
})

describe('English demo date patterns', () => {
  it('resolves English weekdays and extra players without changing UTC generation', () => {
    const ctx = { now, timezone: 'America/Chicago', locale: 'en' as const }
    const draft = core.mockParseDraft('Board games next Friday afternoon, find 3 more players, in person', ctx)
    expect(draft.dates).toEqual(['2026-10-30'])
    expect(draft.headcount.min).toBe(4)
    expect(draft.mode).toBe('offline')
    expect(core.expandDraft(draft, ctx).slots[0]?.startUtc).toBe('2026-10-30T19:00:00.000Z')
  })
  it('keeps unsupported natural-language input visibly uncertain', () => {
    const result = core.expandDraft(core.mockParseDraft('Something fun whenever', { now, timezone: 'Asia/Shanghai' }), {
      now,
      timezone: 'Asia/Shanghai',
      locale: 'en',
    })
    expect(result.uncertain).toContain('options')
    expect(result.uncertain).toContain('when')
    expect(result.title).toBe('Something to play')
  })
})

it('falls back to literal unknown message keys including object prototype names', () => {
  expect(core.translate('en', 'constructor')).toBe('constructor')
  expect(core.translate('en', 'unknown {0}', '不翻译')).toBe('unknown 不翻译')
})
