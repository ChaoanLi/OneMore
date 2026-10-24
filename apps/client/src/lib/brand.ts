import { t } from './i18n'
/**
 * 品牌信息集中在这里。改名时还要同步：src/index.html 的 <title>、app.config.ts 与页面 *.config.ts 的标题、
 * components/Logo.tsx 里 SVG 的文字、packages/core/src/ai/prompt.ts 的助手名。
 */
export const APP_NAME = 'OneMore'
export const APP_NAME_EN = 'OneMore'
export const TAGLINE = '把「下次一定」变成这次。'
export const tagline = () => t(TAGLINE)

/** 首页随机一句“本周挑战”，学 Nice Try 的口吻：具体、有点自嘲 */
const CHALLENGES = [
  '约成一局，并且没有人鸽',
  '把“下次一定”变成这次',
  '和一个半年没联系的朋友打一盘',
  '凑齐四个人，打完一整个半庄',
  '在中美时差里找到一个大家都醒着的时间',
  '跑一次团，KP 不迟到',
  '五黑一晚上，没有人说“最后一把”',
  '当一次组局的人（不催任何人）',
]

/** 每周固定一句，同一周里刷新不会变 */
export function weeklyChallenge(now = new Date()): string {
  const week = Math.floor(now.getTime() / (7 * 24 * 3600_000))
  return t(CHALLENGES[week % CHALLENGES.length]!)
}
