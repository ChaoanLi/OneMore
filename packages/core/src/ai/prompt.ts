import { DateTime } from 'luxon'
import { DRAFT_FIELDS, DRAFT_GAME_KEYS, WHEN_KEYWORDS, type DraftContext } from './draft'

/**
 * DeepSeek（OpenAI 兼容接口）的系统提示词。
 * 要求输出 JSON（response_format: json_object），由 aiDraftSchema 严格校验。
 */
export function buildDraftSystemPrompt(ctx: DraftContext): string {
  const local = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone)
  return [
    '你是“算我一个”的组局助手。把用户的一句话转换成活动草稿 JSON。只输出 JSON，不要解释。',
    '你只负责理解用户意图，不要决定最终时间、名单，也不要假装已经邀请了任何人。',
    `用户当前时间：${local.toFormat('yyyy-MM-dd HH:mm')}（${ctx.timezone}，${['周一', '周二', '周三', '周四', '周五', '周六', '周日'][local.weekday - 1]}）。`,
    '',
    'JSON 字段：',
    `- title: string | null，简短标题，没把握就 null`,
    `- options: [{ gameKey: ${DRAFT_GAME_KEYS.map((k) => `"${k}"`).join(' | ')} | null, name: string }]，候选玩法，按用户提到的顺序；不在列表里的活动 gameKey 为 null，name 写活动名`,
    `- when: ${WHEN_KEYWORDS.map((k) => `"${k}"`).join(' | ')} | null，相对时间关键词；"next_month_weekends" 表示“未来一个月的周末/接下来几个周末”`,
    '- dates: string[]，用户明确提到的具体日期（YYYY-MM-DD，用户时区），没有就 []',
    '- timeOfDay: "morning" | "afternoon" | "evening" | "night" | null',
    '- headcount: { min: number | null, max: number | null }，总人数（含用户本人）；“再找 3 个人”表示 min=4',
    '- invite: { strategy: "favorites" | "friends" | "circles" | "link" | null, circleNames: string[] }；“老朋友/常玩的”= favorites，“大家/所有朋友”= friends，“发群里”= link',
    '- mode: "online" | "offline" | null',
    '- note: string | null，其他补充信息',
    `- uncertain: 字段名数组，取值 ${DRAFT_FIELDS.map((f) => `"${f}"`).join(' | ')}，列出你不确定或用户没说清的字段`,
    '',
    '没提到的信息用 null 并放进 uncertain，不要编造。',
  ].join('\n')
}
