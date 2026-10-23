import { describe, expect, it } from 'vitest'
import { aiDraftSchema, expandDraft } from '../src/ai/draft'
import { mockParseDraft } from '../src/ai/mockParser'
import { buildDraftSystemPrompt } from '../src/ai/prompt'
import { utcToLocal } from '../src/time'

const ctx = { now: new Date('2026-10-23T15:00:00Z'), timezone: 'America/Chicago' } // 周五上午

describe('mock 解析（演示用规则，不是 AI）', () => {
  it('“这周末没事，想和几个老朋友玩 Dota、桌游或者日麻”', () => {
    const d = mockParseDraft('这周末没事，想和几个老朋友玩 Dota、桌游或者日麻', ctx)
    expect(d.options.map((o) => o.gameKey)).toEqual(['dota2', 'boardgame', 'riichi'])
    expect(d.when).toBe('this_weekend')
    expect(d.invite.strategy).toBe('favorites')
    expect(d.uncertain).toContain('headcount')

    const s = expandDraft(d, ctx)
    expect(s.options).toHaveLength(3)
    expect(s.options[0]).toMatchObject({ name: 'Dota 2', minPlayers: 5, maxPlayers: 5 })
    expect(s.slots.map((x) => utcToLocal(x.startUtc, ctx.timezone))).toEqual([
      '2026-10-24T14:00',
      '2026-10-24T20:00',
      '2026-10-25T14:00',
      '2026-10-25T20:00',
    ])
    expect(s.visibility).toBe('invited')
    expect(s.title).toBe('周末 Dota 2 / 桌游 / 日麻')
  })

  it('“今晚四个人打日麻” → 今晚 20:00，日麻固定 4 人', () => {
    const d = mockParseDraft('今晚四个人打日麻', ctx)
    expect(d).toMatchObject({ when: 'tonight', timeOfDay: 'evening', headcount: { min: 4 } })
    const s = expandDraft(d, ctx)
    expect(s.slots.map((x) => utcToLocal(x.startUtc, ctx.timezone))).toEqual(['2026-10-23T20:00'])
  })

  it('“下周五晚上跑团，再找3个人” → 下周五、4 人、跑团需要 KP', () => {
    const d = mockParseDraft('下周五晚上跑团，再找3个人', ctx)
    expect(d.dates).toEqual(['2026-10-30'])
    expect(d.headcount.min).toBe(4)
    const s = expandDraft(d, ctx)
    expect(s.options[0]).toMatchObject({ gameKey: 'trpg', minPlayers: 4, maxPlayers: 6 })
    expect(s.options[0]!.roles).toEqual([{ key: 'gm', label: 'KP/GM', min: 1 }])
    expect(utcToLocal(s.slots[0]!.startUtc, ctx.timezone)).toBe('2026-10-30T20:00')
  })

  it('什么都没说清楚时，标记不确定字段而不是编造', () => {
    const s = expandDraft(mockParseDraft('想玩点什么', ctx), ctx)
    expect(s.options).toEqual([])
    expect(s.slots).toEqual([])
    expect(s.uncertain).toEqual(expect.arrayContaining(['options', 'when', 'invite']))
  })

  it('线下活动识别', () => {
    const d = mockParseDraft('周六下午大学同学来我家玩桌游', ctx)
    expect(d.mode).toBe('offline')
    expect(d.timeOfDay).toBe('afternoon')
    expect(d.invite).toEqual({ strategy: 'circles', circleNames: ['大学同学'] })
    expect(d.dates).toEqual(['2026-10-24'])
  })
})

describe('结构化输出严格校验（防止模型乱填）', () => {
  it('未知 gameKey / 非法日期 / 未知字段名 → 校验失败', () => {
    expect(aiDraftSchema.safeParse({ options: [{ gameKey: 'lol', name: 'LOL' }] }).success).toBe(false)
    expect(aiDraftSchema.safeParse({ dates: ['下周五'] }).success).toBe(false)
    expect(aiDraftSchema.safeParse({ uncertain: ['budget'] }).success).toBe(false)
  })
  it('缺省字段补默认值', () => {
    const d = aiDraftSchema.parse({})
    expect(d).toMatchObject({ options: [], when: null, headcount: { min: null, max: null } })
  })
  it('系统提示词包含用户时区与当前日期', () => {
    const p = buildDraftSystemPrompt(ctx)
    expect(p).toContain('2026-10-23 10:00')
    expect(p).toContain('America/Chicago')
  })
})

describe('提前排几周', () => {
  it('“未来一个月的周末打日麻” → 接下来 4 个周末晚上', () => {
    const d = mockParseDraft('未来一个月的周末打日麻', ctx)
    expect(d.when).toBe('next_month_weekends')
    const s = expandDraft(d, ctx)
    expect(s.slots.map((x) => utcToLocal(x.startUtc, ctx.timezone))).toEqual([
      '2026-10-24T20:00', '2026-10-25T20:00', '2026-10-31T20:00', '2026-11-01T20:00',
      '2026-11-07T20:00', '2026-11-08T20:00', '2026-11-14T20:00', '2026-11-15T20:00',
    ])
  })
  it('“接下来几个周末下午”也能识别，并用下午时段', () => {
    const s = expandDraft(mockParseDraft('接下来几个周末下午玩桌游', ctx), ctx)
    expect(s.slots[0] && utcToLocal(s.slots[0].startUtc, ctx.timezone)).toBe('2026-10-24T14:00')
    expect(s.slots).toHaveLength(8)
  })
})
