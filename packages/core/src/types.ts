/**
 * 算我一个（代码名 couju）领域类型。所有时间均为 UTC ISO-8601 字符串（例如 "2026-10-24T01:00:00.000Z"），
 * 只在展示层按查看者的 IANA 时区转换。
 */

export type UserId = string
export type ISODateTime = string

/** 账号绑定状态。guest = 仅凭本设备的登录令牌；bound = 已有可恢复的持久凭证。 */
export type AccountBinding =
  | { kind: 'guest' }
  | { kind: 'bound'; method: 'recovery_code' | 'wechat'; boundAt: ISODateTime }

export interface User {
  /** 不可变内部 ID */
  id: UserId
  /** 可分享、可修改、全局唯一的自定义 ID（小写字母/数字/下划线） */
  handle: string
  nickname: string
  /** 头像：MVP 使用 emoji，避免图片上传 */
  avatar: string
  /** IANA 时区，例如 America/Chicago、Asia/Shanghai */
  timezone: string
  /** 偏好的游戏 key（旧字段，保留兼容） */
  games: string[]
  /** 我的游戏：首次设置时从内置目录挑选，也可以自己添加/改人数。未设置时为 undefined */
  myGames?: MyGame[]
  /** 愿意承担的特殊角色，例如 gm */
  roles: string[]
  account: AccountBinding
  createdAt: ISODateTime
}

/** 对其他用户公开的最小资料 */
export interface PublicUser {
  id: UserId
  handle: string
  nickname: string
  avatar: string
  timezone: string
}

/** 用户自己的游戏条目（内置游戏可改默认人数；自定义游戏 gameKey 为 null） */
export interface MyGame {
  id: string
  gameKey: string | null
  name: string
  emoji: string
  minPlayers: number
  maxPlayers: number
  needsGm: boolean
}

// ---------- 社交 ----------

export type FriendshipStatus = 'pending' | 'accepted'

/** 好友关系：一条记录表示两人之间的关系，a < b 保证唯一 */
export interface Friendship {
  id: string
  a: UserId
  b: UserId
  status: FriendshipStatus
  requestedBy: UserId
  createdAt: ISODateTime
  acceptedAt?: ISODateTime
}

/** 私密的好友偏好，仅 owner 本人可见；不公开、不评分 */
export interface FriendPref {
  ownerId: UserId
  friendId: UserId
  /** 常玩好友 */
  favorite: boolean
}

/** 私人圈子，仅 owner 本人可见 */
export interface Circle {
  id: string
  ownerId: UserId
  name: string
  memberIds: UserId[]
  createdAt: ISODateTime
}

// ---------- 游戏与活动 ----------

export interface RoleRequirement {
  /** 角色 key，例如 gm */
  key: string
  /** 展示名，例如 KP/GM */
  label: string
  /** 至少需要几位 */
  min: number
}

export interface GameTemplate {
  key: string
  name: string
  emoji: string
  minPlayers: number
  maxPlayers: number
  roles: RoleRequirement[]
  defaultDurationMin: number
  hint?: string
}

/** 活动中的一种候选玩法。人数包含特殊角色（例如跑团的 KP 也算一个座位）。 */
export interface EventOption {
  id: string
  /** 内置游戏 key；自定义玩法为 null */
  gameKey: string | null
  name: string
  emoji: string
  minPlayers: number
  maxPlayers: number
  roles: RoleRequirement[]
}

export interface TimeSlot {
  id: string
  startUtc: ISODateTime
  endUtc: ISODateTime | null
}

export type EventMode = 'online' | 'offline'

/**
 * link：持有链接的人都能报名（适合发到群里）。
 * invited：只有被邀请的好友/圈子成员能看到详情并报名。
 */
export type Visibility = 'link' | 'invited'

export interface Invitation {
  userId: UserId
  /** 第几批邀请：1 = 优先邀请名单，2+ = 扩大邀请。仅发起人可见。 */
  wave: number
  invitedAt: ISODateTime
}

/**
 * open：收集报名中
 * confirmed：发起人已确认成团（选定玩法 + 时段 + 名单）
 * cancelled：已取消
 * expired：所有候选时段都已过去仍未成团
 * completed：成团后活动时间已结束
 */
export type EventStatus = 'open' | 'confirmed' | 'cancelled' | 'expired' | 'completed'

export interface FinalPlan {
  optionId: string
  slotId: string
  /** 正式名单 */
  rosterIds: UserId[]
  /** 候补名单（按先后顺序） */
  waitlistIds: UserId[]
  /** 角色分配，例如 { gm: [userId] } */
  roleAssignments: Record<string, UserId[]>
  confirmedAt: ISODateTime
}

export interface GameEvent {
  id: string
  /** 分享短码，出现在链接里 */
  code: string
  hostId: UserId
  title: string
  note: string
  mode: EventMode
  location: string
  /** 发起人创建时的时区，用于展示“发起人时间” */
  hostTimezone: string
  options: EventOption[]
  slots: TimeSlot[]
  visibility: Visibility
  invitations: Invitation[]
  allowWaitlist: boolean
  status: EventStatus
  final: FinalPlan | null
  cancelReason: string
  sourceInterestId: string | null
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

/**
 * 想玩 interested：有兴趣，但这些时间都不太行
 * 待定 maybe：可能来，不计入成团
 * 报名 joined：在勾选为 yes 的时段可以来，计入成团
 * 不参加 declined：这次不来（对其他人不可见，发起人只看到匿名人数）
 */
export type ResponseIntent = 'interested' | 'maybe' | 'joined' | 'declined'

export type SlotAvailability = 'yes' | 'maybe' | 'no'

export interface EventResponse {
  eventId: string
  userId: UserId
  intent: ResponseIntent
  availability: Record<string, SlotAvailability>
  /** 可以接受的玩法；空数组表示都可以 */
  optionIds: string[]
  /** 本次愿意承担的角色，例如 ['gm'] */
  roles: string[]
  /** 成团后，名单成员的最终确认 */
  finalConfirmed: boolean
  comment: string
  /** 单调递增序号，用于“先报先得” */
  seq: number
  createdAt: ISODateTime
  updatedAt: ISODateTime
}

// ---------- 我想玩 ----------

export type InterestAudience =
  | { kind: 'favorites' }
  | { kind: 'friends' }
  | { kind: 'circles'; circleIds: string[] }

export type InterestStatus = 'active' | 'converted' | 'expired' | 'withdrawn'

export interface Interest {
  id: string
  ownerId: UserId
  gameKey: string | null
  name: string
  emoji: string
  /** 成团所需最少人数（含发起者） */
  minPlayers: number
  /** 大概什么时候，例如“这周末”“工作日晚上”——只是提示，不做排期 */
  whenHint: string
  note: string
  audience: InterestAudience
  joiners: { userId: UserId; at: ISODateTime }[]
  status: InterestStatus
  convertedEventId: string | null
  expiresAt: ISODateTime
  createdAt: ISODateTime
}

// ---------- 通知 ----------

export type NotificationKind =
  | 'friend_request'
  | 'friend_accepted'
  | 'event_invite'
  | 'event_ready'
  | 'event_confirmed'
  | 'event_cancelled'
  | 'event_short'
  | 'waitlist_promoted'
  | 'interest_new'
  | 'interest_ready'
  | 'join_request'

export interface AppNotification {
  objectId?: string
  id: string
  userId: UserId
  kind: NotificationKind
  title: string
  body: string
  /** 应用内路径，例如 /pages/event/detail?code=xxx */
  link: string
  /** 用于去重与频率限制的键 */
  dedupeKey: string
  createdAt: ISODateTime
  readAt: ISODateTime | null
}
