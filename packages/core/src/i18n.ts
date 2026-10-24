import { localizeBuiltinGame } from './games'
import { slotOneLine } from './time'

export type Locale = 'zh-CN' | 'en'
export type MessageValue = string | number | boolean | null | Message
export interface Message {
  key: string
  args: MessageValue[]
}

/** Missing request language retains the historical Chinese default. */
export function normalizeLocale(value?: string): Locale {
  if (!value?.trim()) return 'zh-CN'
  const preferred = value
    .split(',')
    .map((part, index) => {
      const [language, ...params] = part.trim().split(';')
      const weight = params.find((p) => p.trim().startsWith('q='))
      return { language: language!.trim(), q: weight ? Number(weight.trim().slice(2)) : 1, index }
    })
    .filter((p) => Number.isFinite(p.q) && p.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.language
  return !preferred || /^zh(?:-|$)/i.test(preferred) ? 'zh-CN' : 'en'
}

/** Callback replacement preserves literal dollar signs and nested placeholders in arguments. */
export function formatMessage(template: string, args: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < args.length ? String(args[Number(index)] ?? '') : placeholder,
  )
}
export function message(key: string, ...args: MessageValue[]): Message {
  return { key, args }
}

/** Only explicit system templates are translated; arguments remain user content. */
export function translate(locale: Locale = 'zh-CN', key: string, ...args: unknown[]): string {
  return formatMessage(locale === 'en' && Object.prototype.hasOwnProperty.call(english, key) ? english[key]! : key, args)
}
export function renderMessage(locale: Locale, value: Message): string {
  // System time fragments retain UTC data and render when the viewer reads the notification.
  if (value.key === '$game')
    return localizeBuiltinGame({ gameKey: value.args[0] as string | null, name: value.args[1] as string }, locale).name
  if (value.key === '$slot') {
    const [startUtc, endUtc, timezone] = value.args as [string, string | null, string]
    return slotOneLine({ startUtc, endUtc }, timezone, new Date((value.args[3] as string) ?? 0), locale)
  }
  return translate(
    locale,
    value.key,
    ...value.args.map((arg) => (typeof arg === 'object' && arg !== null ? renderMessage(locale, arg) : arg)),
  )
}

export const english: Readonly<Record<string, string>> = {
  这周末: 'This weekend',
  工作日晚上: 'Weekday evenings',
  随时: 'Anytime',
  招人中: 'Looking for players',
  成了: 'Confirmed',
  取消了: 'Cancelled',
  没凑成: 'Expired',
  玩完了: 'Completed',
  '人齐了，已满员': 'Ready, all seats filled',
  '人数够了，可以开局': 'Enough players, ready to play',
  '还差 {0} 人': 'Still needed: {0}',
  '还差 {0} 人（需要 {1}）': 'Still needed: {0} (requires {1})',
  '{0} 位 {1}': '{0} {1}',
  '这局{0}，现在不能这么做': 'This event is {0}; this action is unavailable',
  '「{0}」有改动': '{0} was updated',
  '{0} 改了时间或地点，点进来看看还合不合适': '{0} changed the time or place. Check that it still works for you.',
  '成团后时间就定了；要改时间，先重新开放报名': 'The time is locked once confirmed. Reopen sign-ups to change it.',
  至少留一个时间: 'Keep at least one time',
  '{0} 加入了「{1}」': '{0} joined {1}',
  通过邀请链接加入: 'Joined with the invite link',
  '通过「{0}」的链接加入': 'Joined from the link to {0}',
  链接已失效: 'This link is no longer valid',
  '这局的链接不能用来加入组，请找组里的人要邀请链接': "This event link can't be used to join the space. Ask a member for an invite link.",
  标题不能为空: 'Title is required',
  组局的人不能这么做: 'The host cannot do this',
  只有组局的人能这么做: 'Only the host can do this',
  今天: 'Today',
  明天: 'Tomorrow',
  后天: 'In two days',
  今晚: 'Tonight',
  周末: 'This weekend',
  下周末: 'Next weekend',
  这周: 'This week',
  下周: 'Next week',
  工作日: 'Weekdays',
  这个月周末: 'Upcoming weekends',
  玩点什么: 'Something to play',
  '今晚 20:00': 'Tonight 20:00',
  '明晚 20:00': 'Tomorrow 20:00',
  周五晚: 'Friday evening',
  周六下午: 'Saturday afternoon',
  周六晚: 'Saturday evening',
  周日下午: 'Sunday afternoon',
  周日晚: 'Sunday evening',
  '未来 4 个周末晚上': 'Next 4 weekends, evenings',
  '未来 4 个周六下午': 'Next 4 Saturdays, afternoons',
  '未来 4 个周五晚上': 'Next 4 Fridays, evenings',
  接下来两周工作日晚上: 'Next 2 weeks, weekday evenings',
  日麻: 'Riichi mahjong',
  桌游: 'Board games',
  'TRPG 跑团': 'TRPG',
  狼人杀: 'Werewolf',
  '五黑；想打内战可把上限改成 10': 'Five-player team; set the maximum to 10 for an in-house match',
  '四人麻将；三麻可把人数改成 3': 'Four-player mahjong; change to 3 for sanma',
  '需要一位 KP/GM（人数包含 KP）': 'Requires one KP/GM (included in the player count)',
  '{0} 想加你为好友': '{0} wants to add you as a friend',
  '在“好友”页可以接受': 'Accept on the Friends page',
  请先登录并加入空间: 'Please sign in and join a space',
  请先选择空间: 'Please select a space',
  '成员资格已变更，请重新打开页面': 'Your membership changed; please reopen this page',
  请先告诉我们怎么称呼你: 'Please sign in with a nickname',
  输入有误: 'Invalid input',
  '服务器开小差了，请稍后再试': 'Something went wrong; please try again later',
  '操作太频繁，请稍后再试': 'Too many requests; please try again later',
  '尝试次数太多，请 15 分钟后再试': 'Too many attempts; please try again in 15 minutes',
  '微信登录尚未接入（需要小程序 AppID 与后端 code2Session）':
    'WeChat sign-in is not configured (requires a mini-program AppID and server code2Session)',
  订阅链接无效: 'Invalid calendar subscription link',
  '说得太快啦，歇一会儿再试': 'Too many draft requests; please try again shortly',
  请稍后再试: 'Please try again later',
  '这个 ID 已被使用': 'This ID is already taken',
  'ID 或恢复码不正确': 'Incorrect ID or recovery code',
  找不到这个用户: 'User not found',
  无效的时区: 'Invalid time zone',
  请填写昵称: 'Please enter a nickname',
  '昵称最多 20 个字': 'Nickname must be at most 20 characters',
  'ID 需为 3–20 位小写字母、数字或下划线': 'ID must be 3–20 lowercase letters, numbers or underscores',
  无效的时间: 'Invalid time',
  游戏名不能为空: 'Please enter a game name',
  '游戏名最多 20 个字': 'Game name must be at most 20 characters',
  最少人数不能大于最多人数: 'Minimum players cannot exceed maximum players',
  '最多 30 个游戏': 'Choose at most 30 games',
  请填写玩法名称: 'Please enter a game or activity name',
  最低人数不能大于人数上限: 'Minimum players cannot exceed maximum players',
  特殊角色数量超过了人数上限: 'Required roles exceed the player limit',
  结束时间要晚于开始时间: 'End time must be after start time',
  至少选择一种玩法: 'Choose at least one game or activity',
  '最多 6 种候选玩法': 'Choose at most 6 games or activities',
  至少选择一个时间: 'Choose at least one time',
  '最多 24 个候选时间': 'Choose at most 24 candidate times',
  '最多 {0} 个候选时间': 'Choose at most {0} candidate times',
  '仅邀请可见时，请至少选择一位好友或一个圈子': 'Choose at least one friend or circle for an invite-only event',
  请填写圈子名: 'Please enter a circle name',
  邮箱格式不对: 'Invalid email address',
  '验证码是 6 位数字': 'Verification code must contain 6 digits',
  至少填一个邮箱: 'Enter at least one email address',
  '一次最多 10 个邮箱': 'Enter at most 10 email addresses at once',
  多说一点吧: 'Please add a little more detail',
  '最多 300 字': 'Use at most 300 characters',
  没有权限: 'Permission denied',
  找不到了: 'Not found',
  空间不存在: 'Space not found',
  只能选择当前空间的成员: 'Only members of the current space can be selected',
  活动不存在: 'Event not found',
  你还不是这个空间的成员: 'You are not a member of this space',
  只有空间管理员能操作: 'Only the space owner can do this',
  请填写空间名称: 'Please enter a space name',
  空间名称最多30字: 'Space name must be at most 30 characters',
  最多加入20个空间: 'You can join at most 20 spaces',
  邀请链接已失效: 'This invitation link has expired',
  申请不存在: 'Join request not found',
  申请已处理: 'This request has already been handled',
  对方已加入20个空间: 'This person has already joined 20 spaces',
  管理员不能退出或移除自己: 'The space owner cannot leave or remove themselves',
  '找不到这个 ID': 'ID not found',
  不能加自己为好友: 'You cannot add yourself as a friend',
  没有待处理的好友请求: 'No pending friend request',
  不是好友: 'This person is not a friend',
  只能选择当前空间的好友: 'Only friends in the current space can be selected',
  '圈子最多 20 个': 'You can create at most 20 circles',
  找不到圈子: 'Circle not found',
  活动不存在或链接有误: 'Event not found or invalid link',
  玩法不存在: 'Game or activity not found',
  时段不存在: 'Time slot not found',
  只能邀请当前空间的好友: 'Only friends in the current space can be invited',
  圈子不存在或不属于你: 'Circle not found or does not belong to you',
  发起人不存在: 'Host not found',
  没有可选的时间了: 'No available times remain',
  '有时间已经过去了，请重新选择': 'Some times are in the past; please choose again',
  '这条“想玩”已失效': 'This interest post is no longer active',
  只有参与者可以发起: 'Only participants can create an event',
  有人: 'Someone',
  请至少选一个可以参加的时间: 'Choose at least one time you can attend',
  '这是仅邀请可见的活动，请联系发起人邀请你': 'This event is invite-only; ask the host for an invitation',
  你不在正式名单里: 'You are not on the roster',
  你还没有报名: 'You have not joined yet',
  这个时间已经过了: 'This time is in the past',
  '还不能成团：{0}': 'Not ready yet: {0}',
  这个人不在候补名单: 'This person is not on the waitlist',
  正式名单已满: 'The roster is full',
  有时间已经过去了: 'Some times are in the past',
  只能选择当前空间内自己的圈子: 'Only your circles in the current space can be selected',
  '想玩什么？': 'What would you like to play?',
  '同时最多挂 5 条“想玩”，先撤掉一条吧': 'You can have at most 5 active interest posts; withdraw one first',
  '这条“想玩”不存在': 'Interest post not found',
  '这条“想玩”已经结束了': 'This interest post has ended',
  这是你自己发的: 'This is your own post',
  邮件功能没有启用: 'Email is not enabled',
  '验证码发得太频繁了，一小时后再试': 'Too many verification codes; try again in an hour',
  '先填邮箱、收验证码': 'Enter an email address and request a code first',
  '验证码过期了，重新发一个吧': 'This code has expired; request a new one',
  '错太多次了，重新发一个验证码吧': 'Too many incorrect attempts; request a new code',
  验证码不对: 'Incorrect verification code',
  还没有验证过的邮箱: 'No verified email address',
  只有组局的人能用邮件叫人: 'Only the host can send email invitations',
  这局现在不收人了: 'This event is no longer accepting players',
  '只能邀请已加入本空间并验证邮箱的成员；新人请先使用空间邀请链接':
    'Email invitations require a space member with a verified email; invite newcomers to the space first',
  请先把该成员加入活动邀请名单: 'Add this member to the event invitation list first',
  退订链接无效: 'Invalid unsubscribe link',
  订阅链接无效或已重新生成: 'Calendar subscription link is invalid or has been replaced',
  'AI 服务暂不可用（{0}）': 'AI service is unavailable ({0})',
  'AI 没有返回内容': 'AI returned no content',
  'AI 返回的不是合法 JSON': 'AI returned invalid JSON',
  'AI 返回的结构不符合要求': 'AI returned an invalid draft structure',
  'AI 服务连接失败': 'Could not connect to the AI service',
  '{0} 约你：{1}': '{0} invited you: {1}',
  ' 等 {0} 个时间': ' · {0} possible times',
  '{0}{1}，有空就来，没空不用回': '{0}{1}. Join if you are free; no need to reply otherwise',
  '「{0}」{1} 临时有事': '“{0}”: {1} can no longer make it',
  '还差 {0} 个，候补里有 {1} 人可以补上': 'Need {0} more; {1} players are on the waitlist',
  '还差 {0} 个，可以再叫几个人，或者重新开放': 'Need {0} more; invite more players or reopen the event',
  '「{0}」人齐了': '“{0}” has enough players',
  '{0} · {1} {2} {3} 人，点一下就定了': '{0} · {1} {2}, {3} players. Confirm to make it official',
  '「{0}」就差一个': '“{0}” needs just one more',
  '{0} · {1}，方便就来，不方便当没看见就好': '{0} · {1}. Join if you can; no pressure',
  '「{0}」成了！': '“{0}” is confirmed!',
  '{0} · {1} {2}，点开说一声你会来': '{0} · {1} {2}. Open to confirm you will attend',
  '「{0}」成了，你在候补': '“{0}” is confirmed; you are on the waitlist',
  '{0}，有人鸽了会第一时间叫你': '{0}. We will let you know if a seat opens',
  '「{0}」空出一个位置': 'A seat opened in “{0}”',
  '{0}，轮到你了！点开说一声你会来': '{0}. You are up! Open to confirm you will attend',
  '「{0}」这局取消了': '“{0}” was cancelled',
  '发起人取消了这次活动，下次再约': 'The host cancelled this event. Catch you next time',
  '{0} 举手想玩 {1} {2}': '{0} wants to play {1} {2}',
  '{0}，': '{0}, ',
  '{0}想玩就 +1，不想玩当没看见': '{0}Add +1 if interested; no pressure',
  '{0} {1} 人齐了（{2} 个）': '{0} {1} has enough players ({2})',
  '谁有空谁来定个时间，就能开了': 'Anyone participating can pick a time and create an event',
  '{0} 和你成为了好友': 'You and {0} are now friends',
  '{0} 接受了你的好友请求': '{0} accepted your friend request',
  '{0} 已取消': '{0} was cancelled',
  组局人已退出空间: 'The host left the space',
  '{0} 有成员退出': 'A member left {0}',
  '该成员已退出空间，未来活动报名和席位已撤回，请检查人数。':
    'This member left the space and was removed from upcoming activities. Please check the roster.',
  '{0} 参与情况有变化': 'Participation changed for {0}',
  '发起人已退出空间，这条想玩已撤回。': 'The author left the space and this interest post was withdrawn.',
  '有成员退出空间，想玩人数已更新。': 'A member left the space; the interest count has been updated.',
  '{0} {1} · {2}/{3} 人': '{0} {1} · {2}/{3} players',
  '你的验证码：{0}': 'Your verification code: {0}',
  '{0}，在「算我一个」里输入这 6 位数字，就能收到成团、差一个人之类的邮件提醒。':
    '{0}, enter these 6 digits in OneMore to receive event and player reminders.',
  '15 分钟内有效。不是你本人操作的话，忽略这封邮件就好。': 'Valid for 15 minutes. If you did not request this, ignore this email.',
  '这封邮件由「算我一个 · OneMore」自动发送。': 'This email was sent automatically by OneMore.',
  '【算我一个】验证码 {0}': '[OneMore] Verification code {0}',
  点开看看: 'Open OneMore',
  '{0}，你在「算我一个」打开了邮件提醒。夜里（你那边 23 点到 8 点）不会发。':
    '{0}, you enabled OneMore email reminders. Reminders are paused between 23:00 and 08:00 in your time zone.',
  '组局人那边是 {0}': 'Host time: {0}',
  '登录当前空间后即可报名，有空就来。': 'Sign in to this space to join if you are free.',
  看看能不能来: 'View event',
  '这封邮件是 {0} 通过「算我一个」发给你的。': '{0} sent you this email through OneMore.',
  不想再收到这类邮件: 'Unsubscribe from these emails',
  '名单：{0}': 'Players: {0}',
  已退订: 'Unsubscribed',
  '{0} 之后不会再收到任何邮件。想重新接收，在 App 的“我”里重新验证邮箱即可。':
    '{0} will no longer receive emails. To enable them again, verify your email in your OneMore profile.',
  '退订链接无效。': 'Invalid unsubscribe link.',
  请选择有效选项: 'Please choose a valid option',
  输入类型不正确: 'Invalid input type',
  输入太短或数量不足: 'Input is too short or contains too few items',
  输入太长或数量过多: 'Input is too long or contains too many items',
  输入格式不正确: 'Invalid input format',
  输入不符合要求: 'Input does not meet the requirements',
  请输入有效的倍数: 'Please enter a valid multiple',
  包含无法识别的字段: 'Input contains unrecognized fields',
}
