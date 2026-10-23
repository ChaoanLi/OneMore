import type { AiDraft, DraftSuggestion } from './ai/draft'
import type { EventEvaluation, MissingRole } from './quorum'
import type { SlotDisplay } from './time'
import type {
  AppNotification,
  Circle,
  EventResponse,
  EventStatus,
  GameEvent,
  Interest,
  PublicUser,
  ResponseIntent,
  SlotAvailability,
  TimeSlot,
  User,
} from './types'

/** HTTP API 的响应结构（前后端共用的契约） */

export interface ParticipantView {
  user: PublicUser
  intent: Exclude<ResponseIntent, 'declined'>
  availability: Record<string, SlotAvailability>
  optionIds: string[]
  roles: string[]
  finalConfirmed: boolean
  comment: string
}

/** 时段 + 按查看者时区格式化好的文字（服务端计算，小程序端无需时区库） */
export type SlotView = TimeSlot & SlotDisplay & {
  line: string
  hostLine: string | null
  /** 查看者时区下的日期 YYYY-MM-DD（日历视图用） */
  localDate: string
}

export interface EventView {
  event: Omit<GameEvent, 'invitations' | 'slots'> & { slots: SlotView[]; statusText: string }
  host: PublicUser
  viewer: {
    role: 'host' | 'participant' | 'anonymous'
    timezone: string
    invited: boolean
    canRespond: boolean
    response: EventResponse | null
    inRoster: boolean
    inWaitlist: boolean
  }
  /** 仅邀请可见的活动，非受邀者只能看到简要信息 */
  restricted: boolean
  participants: ParticipantView[]
  evaluation: EventEvaluation | null
  /** 成团后名单是否仍满足条件 */
  rosterCheck: { ok: boolean; stillNeed: number; missingRoles: MissingRole[] } | null
  /** 只有发起人能看到 */
  hostOnly: {
    declinedCount: number
    invitees: { user: PublicUser; wave: number; responded: boolean }[]
  } | null
}

export interface EventCard {
  code: string
  title: string
  status: EventStatus
  statusText: string
  isHost: boolean
  host: PublicUser
  options: { emoji: string; name: string }[]
  whenText: string
  progress: string
  myIntent: ResponseIntent | null
  needsMyResponse: boolean
  joinedCount: number
  nextStartUtc: string | null
}

export interface InterestView {
  id: string
  owner: PublicUser
  gameKey: string | null
  name: string
  emoji: string
  minPlayers: number
  whenHint: string
  note: string
  status: Interest['status']
  convertedEventCode: string | null
  expiresAt: string
  headcount: number
  stillNeed: number
  ready: boolean
  /** 只有参与者能看到名单 */
  participants: PublicUser[] | null
  joinedByMe: boolean
  isMine: boolean
}

export interface FriendEntry {
  user: PublicUser
  favorite: boolean
  since: string
}

export interface FriendsResponse {
  friends: FriendEntry[]
  incoming: PublicUser[]
  outgoing: PublicUser[]
}

export interface AuthResponse {
  token: string
  user: User
}

export interface MeResponse {
  user: User
  unread: number
}

export interface MyEventsResponse {
  active: EventCard[]
  past: EventCard[]
}

export interface InterestsResponse {
  mine: InterestView[]
  friends: InterestView[]
}

export interface CirclesResponse {
  circles: Circle[]
}

export interface NotificationsResponse {
  items: AppNotification[]
  unread: number
}

export interface AiDraftResponse {
  provider: 'mock' | 'deepseek'
  draft: AiDraft
  suggestion: DraftSuggestion
}

export type CalendarItemKind = 'confirmed' | 'waitlist' | 'candidate'

export interface CalendarItem {
  code: string
  title: string
  emoji: string
  kind: CalendarItemKind
  isHost: boolean
  slotId: string
  startUtc: string
  endUtc: string | null
  /** 按查看者时区的日期 YYYY-MM-DD（服务端计算，客户端无需时区库） */
  localDate: string
  timeLabel: string
  /** 候选时间：我选了什么；null = 还没回话 */
  myAvailability: SlotAvailability | null
}

export interface CalendarResponse {
  /** YYYY-MM */
  month: string
  /** 查看者时区下的今天 YYYY-MM-DD */
  today: string
  timezone: string
  items: CalendarItem[]
}

export interface CalendarFeedResponse {
  enabled: boolean
  /** 只在生成时返回一次，例如 /api/calendar/feed/xxxx.ics */
  path: string | null
}

export interface EmailSettingsResponse {
  /** 已验证的邮箱 */
  email: string | null
  enabled: boolean
  /** 等待验证的邮箱 */
  pending: string | null
  /** smtp = 真的会发出；console = 演示模式，只打印在服务器日志 */
  transport: 'smtp' | 'console'
  /** 仅演示模式：直接返回验证码，方便试用 */
  devCode?: string
}

export interface EmailInviteResponse {
  sent: number
  skipped: { email: string; reason: 'unsubscribed' | 'rate_limited' | 'duplicate' }[]
  transport: 'smtp' | 'console'
}

export interface ApiErrorBody {
  error: string
  message: string
}
