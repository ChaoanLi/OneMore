import { z } from 'zod'
import { CUSTOM_GAME_EMOJI, findGame } from '../games'
import { addMinutes, localToUtc, resolveWhen, suggestSlots, type TimeOfDay, type WhenKeyword } from '../time'
import type { EventOptionInput } from '../schemas'

/**
 * AI 组局草稿。
 *
 * 语言模型（或 mock 解析器）只负责“理解”：提取玩法、相对时间、时段偏好、人数、邀请策略，
 * 并标记不确定字段。具体日期/时段由 expandDraft 用确定性代码生成；
 * 是否成团由规则引擎判断；邀请必须由用户在表单里确认后才会发出。
 */

export const DRAFT_GAME_KEYS = ['dota2', 'riichi', 'boardgame', 'trpg', 'werewolf'] as const
export const WHEN_KEYWORDS = ['tonight', 'tomorrow', 'this_weekend', 'next_weekend', 'this_week', 'next_week', 'weekdays', 'next_month_weekends'] as const
export const DRAFT_FIELDS = ['title', 'options', 'when', 'timeOfDay', 'headcount', 'invite', 'mode'] as const
export type DraftField = (typeof DRAFT_FIELDS)[number]

export const aiDraftSchema = z.object({
  title: z.string().max(40).nullable().default(null),
  options: z
    .array(
      z.object({
        gameKey: z.enum(DRAFT_GAME_KEYS).nullable(),
        name: z.string().trim().min(1).max(30),
      }),
    )
    .max(6)
    .default([]),
  when: z.enum(WHEN_KEYWORDS).nullable().default(null),
  /** 明确提到的日期（用户时区，YYYY-MM-DD），优先于 when */
  dates: z
    .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .max(7)
    .default([]),
  timeOfDay: z.enum(['morning', 'afternoon', 'evening', 'night']).nullable().default(null),
  headcount: z
    .object({
      min: z.number().int().min(2).max(50).nullable().default(null),
      max: z.number().int().min(2).max(50).nullable().default(null),
    })
    .default({ min: null, max: null }),
  invite: z
    .object({
      strategy: z.enum(['favorites', 'friends', 'circles', 'link']).nullable().default(null),
      circleNames: z.array(z.string().max(20)).max(5).default([]),
    })
    .default({ strategy: null, circleNames: [] }),
  mode: z.enum(['online', 'offline']).nullable().default(null),
  note: z.string().max(200).nullable().default(null),
  uncertain: z.array(z.enum(DRAFT_FIELDS)).default([]),
})

export type AiDraft = z.output<typeof aiDraftSchema>

export interface DraftContext {
  now: Date
  timezone: string
}

export interface DraftSuggestion {
  title: string
  options: EventOptionInput[]
  slots: { startUtc: string; endUtc: string }[]
  mode: 'online' | 'offline'
  visibility: 'link' | 'invited'
  inviteStrategy: 'favorites' | 'friends' | 'circles' | 'link' | null
  circleNames: string[]
  note: string
  /** 需要用户重点确认的字段 */
  uncertain: DraftField[]
}

const WHEN_TEXT: Record<WhenKeyword, string> = {
  tonight: '今晚',
  tomorrow: '明天',
  this_weekend: '周末',
  next_weekend: '下周末',
  this_week: '这周',
  next_week: '下周',
  weekdays: '工作日',
  next_month_weekends: '这个月周末',
}

export function defaultTitle(optionNames: string[], when: WhenKeyword | null): string {
  const games = optionNames.length ? optionNames.slice(0, 3).join(' / ') : '玩点什么'
  const prefix = when ? `${WHEN_TEXT[when]}` : ''
  return `${prefix}${prefix ? ' ' : ''}${games}`.slice(0, 40)
}

/** 把草稿展开成可编辑的表单建议：补全人数默认值、生成候选时段。 */
export function expandDraft(draft: AiDraft, ctx: DraftContext): DraftSuggestion {
  const uncertain = new Set<DraftField>(draft.uncertain)

  const options: EventOptionInput[] = draft.options.map((o) => {
    const game = findGame(o.gameKey)
    let minPlayers = game?.minPlayers ?? 2
    let maxPlayers = game?.maxPlayers ?? 8
    const fixedSize = game ? game.minPlayers === game.maxPlayers : false
    // 只对人数不固定的玩法应用“几个人”，避免把五黑改成四人
    if (!fixedSize && draft.headcount.min) {
      minPlayers = draft.headcount.min
      maxPlayers = Math.max(maxPlayers, minPlayers)
    }
    if (!fixedSize && draft.headcount.max) maxPlayers = Math.max(minPlayers, draft.headcount.max)
    return {
      gameKey: game ? game.key : null,
      name: game ? game.name : o.name,
      emoji: game ? game.emoji : CUSTOM_GAME_EMOJI,
      minPlayers,
      maxPlayers,
      roles: game ? game.roles.map((r) => ({ ...r })) : [],
    }
  })
  if (options.length === 0) uncertain.add('options')

  const durationMin = Math.max(120, ...draft.options.map((o) => findGame(o.gameKey)?.defaultDurationMin ?? 120))
  let slots: { startUtc: string; endUtc: string }[] = []
  const timeOfDay = draft.timeOfDay as TimeOfDay | null
  if (draft.dates.length > 0) {
    const t = timeOfDay === 'morning' ? '10:00' : timeOfDay === 'afternoon' ? '14:00' : timeOfDay === 'night' ? '21:30' : '20:00'
    slots = draft.dates
      .map((d) => localToUtc(`${d}T${t}`, ctx.timezone))
      .filter((s) => Date.parse(s) > ctx.now.getTime())
      .slice(0, 6)
      .map((startUtc) => ({ startUtc, endUtc: addMinutes(startUtc, durationMin) }))
  } else if (draft.when === 'next_month_weekends') {
    // “未来一个月的周末”：接下来 4 个周末，每天一个时段（默认晚上）
    slots = suggestSlots({
      range: resolveWhen(draft.when, ctx.now, ctx.timezone),
      timeOfDay: timeOfDay ?? 'evening',
      tz: ctx.timezone,
      now: ctx.now,
      durationMin,
      weekdays: [6, 7],
      maxSlots: 8,
    })
  } else if (draft.when) {
    slots = suggestSlots({
      range: resolveWhen(draft.when, ctx.now, ctx.timezone),
      timeOfDay,
      tz: ctx.timezone,
      now: ctx.now,
      durationMin,
    })
  }
  if (slots.length === 0) uncertain.add('when')

  const strategy = draft.invite.strategy
  if (!strategy) uncertain.add('invite')
  const onlineByDefault = draft.options.every((o) => o.gameKey === 'dota2' || o.gameKey === 'riichi')
  if (!draft.mode && !onlineByDefault) uncertain.add('mode')

  return {
    title: draft.title?.trim() || defaultTitle(options.map((o) => o.name), draft.when),
    options,
    slots,
    mode: draft.mode ?? 'online',
    visibility: strategy === 'link' || strategy === null ? 'link' : 'invited',
    inviteStrategy: strategy,
    circleNames: draft.invite.circleNames,
    note: draft.note ?? '',
    uncertain: DRAFT_FIELDS.filter((f) => uncertain.has(f)),
  }
}

export const DRAFT_FIELD_LABELS: Record<DraftField, string> = {
  title: '标题',
  options: '玩什么',
  when: '时间',
  timeOfDay: '时段',
  headcount: '人数',
  invite: '邀请谁',
  mode: '线上/线下',
}
