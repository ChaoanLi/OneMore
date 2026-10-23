import { DateTime } from 'luxon'
import { aiDraftSchema, type AiDraft, type DraftContext, type DraftField } from './draft'

/**
 * 演示用的规则解析器（不是 AI）。
 * 用关键词把一句话转成与 DeepSeek 输出相同结构的草稿，供未配置 API Key 时演示与测试。
 */

const GAME_PATTERNS: { key: AiDraft['options'][number]['gameKey']; name: string; re: RegExp }[] = [
  { key: 'dota2', name: 'Dota 2', re: /dota\s*2?|刀塔|打刀|doto/i },
  { key: 'riichi', name: '日麻', re: /日麻|立直|雀魂|麻将|打麻/ },
  { key: 'trpg', name: 'TRPG 跑团', re: /跑团|trpg|coc|克苏鲁|dnd|d&d|龙与地下城/i },
  { key: 'werewolf', name: '狼人杀', re: /狼人杀/ },
  { key: 'boardgame', name: '桌游', re: /桌游|board\s*game|卡坦|阿瓦隆|璀璨宝石/i },
]

const CUSTOM_PATTERNS: { name: string; re: RegExp; offline: boolean }[] = [
  { name: '剧本杀', re: /剧本杀/, offline: true },
  { name: '密室逃脱', re: /密室/, offline: true },
  { name: '羽毛球', re: /羽毛球/, offline: true },
  { name: '篮球', re: /篮球/, offline: true },
  { name: 'KTV', re: /ktv|唱歌|唱k/i, offline: true },
  { name: '火锅', re: /火锅/, offline: true },
  { name: '看电影', re: /电影/, offline: true },
  { name: '爬山', re: /爬山|徒步/, offline: true },
]

const CN_NUM: Record<string, number> = { 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
const CN_WEEKDAY: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 }

function toNum(s: string): number | null {
  if (/^\d+$/.test(s)) return Number(s)
  return CN_NUM[s] ?? null
}

export function mockParseDraft(text: string, ctx: DraftContext): AiDraft {
  const t = text.trim()
  const uncertain = new Set<DraftField>()

  // 玩法：保持原句中的出现顺序
  const found: { idx: number; option: AiDraft['options'][number]; offline?: boolean }[] = []
  for (const g of GAME_PATTERNS) {
    const m = g.re.exec(t)
    if (m) found.push({ idx: m.index, option: { gameKey: g.key, name: g.name } })
  }
  for (const c of CUSTOM_PATTERNS) {
    const m = c.re.exec(t)
    if (m) found.push({ idx: m.index, option: { gameKey: null, name: c.name }, offline: c.offline })
  }
  found.sort((a, b) => a.idx - b.idx)
  const options = found.map((f) => f.option)
  if (/玩点什么|随便|都行|玩啥/.test(t) && options.length === 0) uncertain.add('options')

  // 时间
  let when: AiDraft['when'] = null
  let timeOfDay: AiDraft['timeOfDay'] = null
  const dates: string[] = []
  if (/今晚|今天晚上/.test(t)) {
    when = 'tonight'
    timeOfDay = 'evening'
  } else if (/明晚|明天晚上/.test(t)) {
    when = 'tomorrow'
    timeOfDay = 'evening'
  } else if (/明天/.test(t)) when = 'tomorrow'
  else if (/(未来|接下来|这)(一|1)?个?月.{0,6}周末|(未来|接下来)(几|[两二三四]|\d)个周末|每个周末/.test(t)) when = 'next_month_weekends'
  else if (/下周末|下个周末/.test(t)) when = 'next_weekend'
  else if (/周末|礼拜六日|星期六日/.test(t)) when = 'this_weekend'
  else if (/下周|下个星期|下礼拜/.test(t)) when = 'next_week'
  else if (/这周|本周|这个星期/.test(t)) when = 'this_week'
  else if (/工作日|平时晚上/.test(t)) when = 'weekdays'

  // 明确的星期几：“周六”“下周五”“星期天”
  const wdRe = /(下)?(?:周|星期|礼拜)([一二三四五六日天])/g
  let wm: RegExpExecArray | null
  const today = DateTime.fromJSDate(ctx.now).setZone(ctx.timezone).startOf('day')
  while ((wm = wdRe.exec(t))) {
    const target = CN_WEEKDAY[wm[2]!]!
    // “下周X”= 下周一所在那一周的周X；“周X”= 最近的一个周X（含今天）
    const d = wm[1]
      ? today.plus({ days: 8 - today.weekday + (target - 1) })
      : today.plus({ days: (target - today.weekday + 7) % 7 })
    const iso = d.toFormat('yyyy-MM-dd')
    if (!dates.includes(iso)) dates.push(iso)
  }
  // “周末”已经覆盖周六周日时，不重复列日期
  if (dates.length > 0 && when && /周末|周六日/.test(t)) dates.length = 0

  if (!timeOfDay) {
    if (/早上|上午|早点/.test(t)) timeOfDay = 'morning'
    else if (/下午/.test(t)) timeOfDay = 'afternoon'
    else if (/深夜|半夜|夜里|通宵/.test(t)) timeOfDay = 'night'
    else if (/晚上|晚饭后|下班后/.test(t)) timeOfDay = 'evening'
  }
  if (!when && dates.length === 0) uncertain.add('when')

  // 人数
  let min: number | null = null
  const extra = /(?:再|还)(?:找|来|差|要|缺)\s*(\d+|[两二三四五六七八九十])\s*(?:个|位)?/.exec(t)
  const total = /(\d+|[两二三四五六七八九十])\s*(?:个人|人|位)/.exec(t)
  if (extra) {
    const n = toNum(extra[1]!)
    if (n) min = n + 1
  } else if (total) {
    const n = toNum(total[1]!)
    if (n && n >= 2) min = n
  }
  if (min === null && /几个|一些|一起/.test(t)) uncertain.add('headcount')

  // 邀请策略
  let strategy: AiDraft['invite']['strategy'] = null
  const circleNames: string[] = []
  const circleMatch = /(大学同学|高中同学|室友|同事|群友)/.exec(t)
  if (/老朋友|常玩|老铁|老友|熟人|老伙计/.test(t)) strategy = 'favorites'
  else if (circleMatch) {
    strategy = 'circles'
    circleNames.push(circleMatch[1]!)
  } else if (/所有人|大家|全部好友|所有朋友/.test(t)) strategy = 'friends'
  else if (/发群|群里|公开|链接/.test(t)) strategy = 'link'

  // 线上 / 线下
  let mode: AiDraft['mode'] = null
  if (/线下|面基|见面|来我家|去我家|店里|聚一下/.test(t) || found.some((f) => f.offline)) mode = 'offline'
  else if (/线上|网上|开黑|雀魂|steam|远程/i.test(t)) mode = 'online'

  return aiDraftSchema.parse({
    title: null,
    options,
    when,
    dates: dates.slice(0, 7),
    timeOfDay,
    headcount: { min, max: null },
    invite: { strategy, circleNames },
    mode,
    note: null,
    uncertain: [...uncertain],
  })
}
