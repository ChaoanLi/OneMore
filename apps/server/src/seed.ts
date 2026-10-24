/**
 * 演示数据：npm run seed
 * 创建 5 位演示用户（跨中美时区）、好友关系、常玩标记、圈子、一个进行中的活动和一条“想玩”。
 * 打印每个人的 ID 与恢复码：在另一个浏览器/无痕窗口里用“我的 → 恢复账号”登录，模拟朋友报名。
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { localToUtc, addMinutes, resolveWhen } from '@couju/core'
import { Store } from './store'
import type { Ctx } from './services/context'
import * as users from './services/users'
import * as social from './services/social'
import * as events from './services/events'
import * as spaces from './services/spaces'
import * as interests from './services/interests'

const here = dirname(fileURLToPath(import.meta.url))
const store = new Store(process.env.DB_PATH || resolve(here, '../data/couju.db'))
let ctx: Ctx = { store, now: () => new Date() }

const people = [
  { handle: 'xiaolin', nickname: '小林', avatar: '🦊', timezone: 'America/Chicago', roles: [] as 'gm'[] },
  { handle: 'ajie', nickname: '阿杰', avatar: '🐼', timezone: 'Asia/Shanghai', roles: ['gm'] as 'gm'[] },
  { handle: 'laowang', nickname: '老王', avatar: '🐯', timezone: 'Asia/Shanghai', roles: [] as 'gm'[] },
  { handle: 'xiaoyu', nickname: '小雨', avatar: '🐧', timezone: 'America/Los_Angeles', roles: [] as 'gm'[] },
  { handle: 'kiki', nickname: 'Kiki', avatar: '🐱', timezone: 'Asia/Shanghai', roles: [] as 'gm'[] },
]

if (store.getUserByHandle('xiaolin')) {
  console.log('演示数据已存在（请使用新的 DB_PATH 创建独立演示数据库，不要删除已有数据）。')
  process.exit(0)
}

const created = people.map((p) => {
  const { user } = users.signupGuest(ctx, { nickname: p.nickname, timezone: p.timezone, avatar: p.avatar })
  const updated = users.updateMe(ctx, user, { handle: p.handle, roles: p.roles })
  const { recoveryCode, user: bound } = users.bindRecoveryCode(ctx, updated)
  return { user: bound, recoveryCode }
})
const [lin, ajie, laowang, xiaoyu, kiki] = created.map((c) => c.user) as [
  (typeof created)[0]['user'],
  (typeof created)[0]['user'],
  (typeof created)[0]['user'],
  (typeof created)[0]['user'],
  (typeof created)[0]['user'],
]

const demoSpace=spaces.createSpace(ctx,lin,{name:'OneMore 演示空间'}).space
for(const p of created.slice(1)) store.saveMembership({spaceId:demoSpace.id,userId:p.user.id,role:'member',joinedAt:ctx.now().toISOString(),emailEnabled:true})
ctx={...ctx,store:store.forSpace(demoSpace.id)}

// 小林和其他人都是好友；阿杰和老王也是好友
for (const other of [ajie, laowang, xiaoyu, kiki]) {
  social.requestFriend(ctx, lin, { handle: other.handle })
  social.acceptFriend(ctx, other, lin.id)
}
social.requestFriend(ctx, ajie, { handle: laowang.handle })
social.acceptFriend(ctx, laowang, ajie.id)

// 小林的私密设置：常玩好友 + 圈子（只有小林自己看得到）
social.setFavorite(ctx, lin, ajie.id, { favorite: true })
social.setFavorite(ctx, lin, laowang.id, { favorite: true })
social.createCircle(ctx, lin, { name: '麻将搭子', memberIds: [ajie.id, laowang.id, kiki.id] })
social.createCircle(ctx, lin, { name: '刀塔五黑', memberIds: [ajie.id, laowang.id, xiaoyu.id] })

// 一个进行中的活动：本周末日麻 / 桌游，两个候选时段（小林时间周六、周日 20:00）
const weekend = resolveWhen('this_weekend', new Date(), lin.timezone)
const dates = weekend.from === weekend.to ? [weekend.from] : [weekend.from, weekend.to]
const slots = dates.map((d) => {
  const startUtc = localToUtc(`${d}T20:00`, lin.timezone)
  return { startUtc, endUtc: addMinutes(startUtc, 150) }
})
const ev = events.createEvent(ctx, lin, {
  title: '周末线上日麻',
  note: '雀魂友人场，新手也欢迎',
  options: [
    { gameKey: 'riichi', name: '日麻', minPlayers: 4, maxPlayers: 4 },
    { gameKey: 'boardgame', name: '桌游', minPlayers: 3, maxPlayers: 6 },
  ],
  slots,
  visibility: 'link',
  invite: { userIds: [ajie.id, laowang.id, kiki.id], circleIds: [] },
})
const firstSlot = 's1'
events.respond(ctx, ajie, ev.code, { intent: 'joined', availability: { [firstSlot]: 'yes', s2: 'maybe' } })
events.respond(ctx, laowang, ev.code, { intent: 'joined', availability: { [firstSlot]: 'yes' }, optionIds: ['o1'] })

// 阿杰想玩跑团（给全部好友看），老王 +1
const it = interests.createInterest(ctx, ajie, { gameKey: 'trpg', whenHint: '下周找个晚上', audience: { kind: 'friends' }, ttlDays: 7 })
interests.joinInterest(ctx, laowang, it.id)

console.log('\n演示数据已创建。用“我的 → 恢复账号”输入 ID 和恢复码登录：\n')
for (const c of created) {
  console.log(`  ${c.user.avatar} ${c.user.nickname.padEnd(4)}  ID: ${c.user.handle.padEnd(8)}  恢复码: ${c.recoveryCode}  (${c.user.timezone})`)
}
console.log(`\n进行中的活动：/#/pages/event/detail?code=${ev.code}&space=${demoSpace.id}\n`)
store.close()
