import { z } from 'zod'
import { isValidTimeZone, MAX_SLOTS } from './time'

/** 前后端共用的输入校验。后端必须调用；前端可用于即时提示。 */

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/

export const timezoneSchema = z.string().refine(isValidTimeZone, { message: '无效的时区' })
export const nicknameSchema = z.string().trim().min(1, '请填写昵称').max(20, '昵称最多 20 个字')
export const handleSchema = z.string().trim().toLowerCase().regex(HANDLE_RE, 'ID 需为 3–20 位小写字母、数字或下划线')
const isoSchema = z.string().refine((s) => !Number.isNaN(Date.parse(s)), { message: '无效的时间' })

export const localeSchema = z.enum(['zh-CN', 'en'])

export const guestSignupSchema = z.object({
  locale: localeSchema.optional(),
  nickname: nicknameSchema,
  timezone: timezoneSchema,
  avatar: z.string().max(8).optional(),
})
export type GuestSignupInput = z.infer<typeof guestSignupSchema>

export const restoreSchema = z.object({
  handle: handleSchema,
  recoveryCode: z.string().trim().min(8).max(40),
})
export type RestoreInput = z.infer<typeof restoreSchema>

export const myGameSchema = z
  .object({
    id: z.string().min(1).max(40),
    gameKey: z.string().max(30).nullable(),
    name: z.string().trim().min(1, '游戏名不能为空').max(20, '游戏名最多 20 个字'),
    emoji: z.string().min(1).max(8),
    minPlayers: z.number().int().min(1).max(50),
    maxPlayers: z.number().int().min(1).max(50),
    needsGm: z.boolean().default(false),
  })
  .refine((g) => g.minPlayers <= g.maxPlayers, { message: '最少人数不能大于最多人数', path: ['minPlayers'] })

export const updateMeSchema = z.object({
  locale: localeSchema.optional(),
  nickname: nicknameSchema.optional(),
  handle: handleSchema.optional(),
  avatar: z.string().min(1).max(8).optional(),
  timezone: timezoneSchema.optional(),
  games: z.array(z.string().max(30)).max(20).optional(),
  roles: z
    .array(z.enum(['gm']))
    .max(5)
    .optional(),
  myGames: z.array(myGameSchema).max(30, '最多 30 个游戏').optional(),
})
export type UpdateMeInput = z.infer<typeof updateMeSchema>

export const roleRequirementSchema = z.object({
  key: z.string().min(1).max(20),
  label: z.string().min(1).max(20),
  min: z.number().int().min(1).max(5),
})

export const eventOptionInputSchema = z
  .object({
    gameKey: z.string().max(30).nullable(),
    name: z.string().trim().min(1, '请填写玩法名称').max(30),
    emoji: z.string().max(8).optional(),
    minPlayers: z.number().int().min(1).max(50),
    maxPlayers: z.number().int().min(1).max(50),
    roles: z.array(roleRequirementSchema).max(3).default([]),
  })
  .refine((o) => o.minPlayers <= o.maxPlayers, { message: '最低人数不能大于人数上限', path: ['minPlayers'] })
  .refine((o) => o.roles.reduce((s, r) => s + r.min, 0) <= o.maxPlayers, {
    message: '特殊角色数量超过了人数上限',
    path: ['roles'],
  })
export type EventOptionInput = z.input<typeof eventOptionInputSchema>

export const slotInputSchema = z
  .object({
    startUtc: isoSchema,
    endUtc: isoSchema.nullable(),
  })
  .refine((s) => !s.endUtc || Date.parse(s.endUtc) > Date.parse(s.startUtc), {
    message: '结束时间要晚于开始时间',
    path: ['endUtc'],
  })
export type SlotInput = z.infer<typeof slotInputSchema>

export const inviteTargetsSchema = z.object({
  userIds: z.array(z.string()).max(100).default([]),
  circleIds: z.array(z.string()).max(20).default([]),
})
export type InviteTargets = z.input<typeof inviteTargetsSchema>

export const createEventSchema = z
  .object({
    title: z.string().trim().max(40).default(''),
    note: z.string().trim().max(300).default(''),
    mode: z.enum(['online', 'offline']).default('online'),
    location: z.string().trim().max(80).default(''),
    options: z.array(eventOptionInputSchema).min(1, '至少选择一种玩法').max(6, '最多 6 种候选玩法'),
    slots: z.array(slotInputSchema).min(1, '至少选择一个时间').max(MAX_SLOTS, `最多 ${MAX_SLOTS} 个候选时间`),
    visibility: z.enum(['link', 'invited']).default('link'),
    invite: inviteTargetsSchema.default({ userIds: [], circleIds: [] }),
    allowWaitlist: z.boolean().default(true),
    sourceInterestId: z.string().nullable().default(null),
    /** 发起人自己也参加：默认所有候选时段都可以 */
    hostJoins: z.boolean().default(true),
    /** 发起人本次愿意承担的角色，例如 ['gm'] */
    hostRoles: z.array(z.string().max(20)).max(3).default([]),
  })
  .refine((e) => e.visibility === 'link' || !!e.sourceInterestId || e.invite.userIds.length + e.invite.circleIds.length > 0, {
    message: '仅邀请可见时，请至少选择一位好友或一个圈子',
    path: ['invite'],
  })
export type CreateEventInput = z.input<typeof createEventSchema>
export type CreateEventParsed = z.output<typeof createEventSchema>

export const respondSchema = z.object({
  intent: z.enum(['interested', 'maybe', 'joined', 'declined']),
  availability: z.record(z.string(), z.enum(['yes', 'maybe', 'no'])).default({}),
  optionIds: z.array(z.string()).max(6).default([]),
  roles: z.array(z.string().max(20)).max(3).default([]),
  comment: z.string().trim().max(100).default(''),
})
export type RespondInput = z.input<typeof respondSchema>

export const confirmSchema = z.object({ optionId: z.string(), slotId: z.string() })
export const cancelSchema = z.object({ reason: z.string().trim().max(100).default('') })
export const addSlotsSchema = z.object({ slots: z.array(slotInputSchema).min(1).max(MAX_SLOTS) })
export const promoteSchema = z.object({ userId: z.string() })

export const friendRequestSchema = z.object({ handle: handleSchema })
export const friendPrefSchema = z.object({ favorite: z.boolean() })

export const circleSchema = z.object({
  name: z.string().trim().min(1, '请填写圈子名').max(20),
  memberIds: z.array(z.string()).max(100).default([]),
})
export type CircleInput = z.input<typeof circleSchema>

export const interestAudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('favorites') }),
  z.object({ kind: z.literal('friends') }),
  z.object({ kind: z.literal('circles'), circleIds: z.array(z.string()).min(1).max(20) }),
])

export const createInterestSchema = z.object({
  gameKey: z.string().max(30).nullable(),
  name: z.string().trim().max(30).default(''),
  emoji: z.string().max(8).optional(),
  minPlayers: z.number().int().min(2).max(50).optional(),
  whenHint: z.string().trim().max(30).default(''),
  whenPreset: z.enum(['tonight', 'this_weekend', 'weekday_evenings', 'next_week', 'anytime']).optional(),
  note: z.string().trim().max(100).default(''),
  audience: interestAudienceSchema.default({ kind: 'favorites' }),
  ttlDays: z.union([z.literal(1), z.literal(3), z.literal(7)]).default(3),
})
export type CreateInterestInput = z.input<typeof createInterestSchema>

export const emailSchema = z.string().trim().toLowerCase().max(254).email('邮箱格式不对')
export const emailRequestSchema = z.object({ email: emailSchema })
export const emailVerifySchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, '验证码是 6 位数字'),
})
export const emailToggleSchema = z.object({ enabled: z.boolean() })
export const emailInviteSchema = z.object({
  emails: z.array(emailSchema).min(1, '至少填一个邮箱').max(10, '一次最多 10 个邮箱'),
  message: z.string().trim().max(100).default(''),
})

export const aiDraftRequestSchema = z.object({
  text: z.string().trim().min(2, '多说一点吧').max(300, '最多 300 字'),
})
