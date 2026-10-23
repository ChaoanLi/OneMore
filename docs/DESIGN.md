# 算我一个 · 产品与技术设计（MVP）

> 产品理念：让朋友们更容易一起玩起来，减少主动喊人、反复约时间和催促报名带来的社交压力。
> 核心是帮熟人从“有点想玩”自然过渡到“找到合适的人和时间，真正成团”。

---

## 1. 核心用户流程与信息架构

### 三个入口（首页只放这三个 + 我的局 + 朋友们想玩）

| 入口 | 用户心态 | 流程 |
|---|---|---|
| **发起一局** | “我来组织” | 选游戏（可多选）→ 勾几个候选时间 → 选邀请对象（或只拿链接）→ 创建 → 分享 |
| **我想玩** | “有点想玩，但不想当组织者” | 选游戏 + 大概时间提示 + 给谁看（默认常玩好友）→ 朋友 +1 → 人够了任何参与者一键“选个时间，发起” |
| **一句话组局** | “懒得填表” | 一句话 → 后端解析成草稿 → 进入同一张表单，标出 AI 不确定的字段 → 用户确认后创建 |

### 朋友报名（验收主流程）

```
发起人创建 → 复制邀请文字/系统分享 → 朋友点开链接（无需登录即可查看）
→ 每个时段点 可以/也许/不行（按朋友自己的时区显示，并对照发起人时间）
→ 点“报名” → 弹出“怎么称呼你？”（只填昵称，时区自动识别）→ 完成
→ 同一时段人数 + 必要角色满足 → 发起人收到“可以开局了”
→ 发起人在候选组合里点“确认开局”（显示名单与候补）→ 名单成员收到通知并“确认参加”
```

低压力设计：
- “这次不了”对其他人不可见；发起人只看到匿名人数，且“拒绝”与“没回应”看起来一样。
- 没有“催报名”按钮。系统只在**只差 1 人**时，温和提醒之前选了“待定/想玩”的人，每个活动 24 小时最多一次。
- 邀请文案统一带“没空不用回”。
- 邀请名单、批次、常玩标记、圈子只对本人可见；没有亲密度评分。

### 信息架构

```
首页（底部导航）
├── 🔔 通知
├── 发起一局 → 活动详情（分享弹层）
├── 我想玩
├── 一句话组局 → 发起一局（预填草稿）
├── 朋友们想玩（+1 / 选个时间发起）
└── 我的局（进行中 / 已结束）→ 活动详情
好友（底部导航）
├── 我的 ID + 加好友链接 / 输入 ID 加好友
├── 好友请求、好友列表（⭐ 常玩，仅自己可见）
└── 圈子 → 新建/编辑圈子
我的（底部导航）
├── 头像、昵称、自定义 ID、时区、常玩游戏、可当 KP/GM
├── 账号：访客 / 恢复码绑定 / 恢复账号 / 退出
└── 关于这个版本（明确列出未接入的服务）
活动详情（分享链接落地页）
├── 状态横幅（最有希望的组合 + 进度，或成团名单）
├── 我的回应 / 报名面板 / 名单确认
├── 发起人面板（候选组合、确认开局、补位、扩大邀请、加时间、重新开放、取消）
├── 大家的时间（每个时段 ✓/? 人数）
└── 报名情况
```

---

## 2. MVP 与下一阶段

| 已在 MVP 实现 | 下一阶段 |
|---|---|
| 访客身份（昵称即可）、自定义 ID、恢复码绑定与恢复 | 微信登录（小程序 code2Session）、手机号/邮箱 |
| 好友请求、常玩标记、私人圈子 | 从同局玩家推荐加好友、通讯录导入 |
| 活动：多候选玩法、自定义玩法、线上/线下、人数上下限、候补、KP/GM 角色 | 编辑已创建活动的玩法、重复活动（每周日麻） |
| 候选时段、快捷时段、按各自时区显示、夏令时 | 日历导入（ICS）、“每周固定空闲时间”模板 |
| 想玩/待定/报名/不参加、最终确认、退出、候补补位 | 自动补位策略、到点提醒 |
| link / invited 两种可见范围、分批扩大邀请 | 申请加入、邀请转发权限 |
| 后端规则引擎判断成团、发起人确认、取消、重新开放、过期 | 多桌并行（10 人分两桌麻将） |
| 我想玩：可见范围、+1、过期、人够提醒、转正式活动 | 根据历史自动推荐“可能想玩的人” |
| 站内通知 + 频率限制 | 微信订阅消息、邮件、推送 |
| AI 草稿接口 + 演示解析 + DeepSeek 适配器（未联调） | 接入真实 Key、对话式修改草稿 |
| 本地 SQLite | 腾讯云 CloudBase（云托管 + 数据库） |

明确不做：聊天、语音、直播、陌生人匹配、公开动态。

---

## 3. 技术栈与复用

| 层 | 选择 | 理由 |
|---|---|---|
| 客户端 | **Taro 4 + React 18 + TypeScript**（webpack5 编译） | 一套代码出 H5 与微信小程序；webpack5 编译链比 Vite 编译链在小程序端更成熟 |
| UI | Taro 内置组件（Picker/Switch/Input/Modal/Toast）+ 自写轻量样式 | 内置 Picker、Modal 两端行为一致；没有引入 NutUI 等组件库，避免体积与两端样式差异。复杂组件需要时可再引入 `@nutui/nutui-react-taro` |
| 领域逻辑 | `packages/core`（纯 TS）：zod 校验、Luxon 时区、规则引擎、状态机 | 前后端共用同一份规则与类型；可单独测试 |
| 后端 | **Hono** + `@hono/node-server` | 轻量、Web 标准 Request/Response，可原样跑在 Node、容器（CloudBase 云托管）或 Serverless |
| 存储 | Node 内置 `node:sqlite` | 零原生依赖；表结构是“文档 JSON + 索引列”，与 CloudBase 文档数据库对齐，迁移只需换 `Store` 实现 |
| 时区 | Luxon（IANA 数据来自 Intl） | 成熟、处理夏令时“跳过/重复”时刻 |
| AI | DeepSeek（OpenAI 兼容 Chat Completions + `response_format: json_object`）+ zod 严格校验 | Key 只在后端；失败/未配置时表单照常可用 |
| 测试 | Vitest（core 规则 + API 集成测试）；Playwright 驱动浏览器做过手工验收 | |

### Rallly 评估

- 许可证：**AGPL-3.0**（GitHub API 核实）。把它的代码并入一个对外提供服务的产品，需要整个服务以 AGPL 开源。
- 技术栈：Next.js + Prisma + PostgreSQL + tRPC，体量远大于本项目，且不支持小程序。
- 结论：**不复用代码**，只借鉴交互思路（候选时段 + 可以/也许/不行三态投票、参与者网格）。算我一个的关键差异——人数与角色约束、同一时段成团判断、熟人隐私——Rallly 本来也没有。

---

## 4. 数据模型、状态机、邀请与成团规则

所有时间以 UTC ISO 字符串存储；用户保存 IANA 时区；展示时在服务端按查看者时区格式化（小程序端无需时区库）。

### 实体（`packages/core/src/types.ts`）

```
User          id(不可变) handle(可改,唯一) nickname avatar timezone games[] roles[] account{guest|bound}
Session       token_hash → user_id                 （令牌只存 SHA-256）
Recovery      user_id → scrypt(恢复码)
Friendship    (a<b) status pending|accepted requestedBy
FriendPref    owner → friend favorite              （仅 owner 可见）
Circle        owner name memberIds[]               （仅 owner 可见，成员必须是好友）
GameEvent     code hostId title note mode location hostTimezone
              options[{id gameKey name emoji min max roles[{key label min}]}]
              slots[{id startUtc endUtc}]
              visibility link|invited  invitations[{userId wave invitedAt}]（仅发起人可见）
              allowWaitlist status final{optionId slotId rosterIds waitlistIds roleAssignments}
EventResponse eventId userId intent interested|maybe|joined|declined
              availability{slotId: yes|maybe|no} optionIds[] roles[] finalConfirmed seq(先报先得)
Interest      owner gameKey name minPlayers whenHint audience{favorites|friends|circles}
              joiners[] status active|converted|expired|withdrawn expiresAt
Notification  userId kind title body link dedupeKey readAt
```

### 活动状态机（`eventState.ts`）

```
open ──confirm(发起人, 必须可成团)──▶ confirmed ──(最终时段结束)──▶ completed
 │  ▲                                  │
 │  └──────────reopen(发起人)───────────┤
 ├──cancel──▶ cancelled ◀──cancel──────┘
 └──(所有时段已开始)──▶ expired ──add_slots──▶ open
```

各状态允许的动作与角色由一张表定义；过期/结束在读取时按时间推导并写回。

### 成团规则（`quorum.ts`，后端为准）

1. 只统计 **intent = 报名** 且 **该时段为“可以”** 且 **接受该玩法** 的人；想玩、待定、“也许”都不计入。
2. 对每个（玩法 × 未来时段）组合：人数 ≥ 最低人数，且每个特殊角色都由**不同的人**承担（二分图匹配，不是贪心）。角色占座位（KP 也算一人）。
3. 名单：先放角色承担者，再按“发起人优先、其余先报先得”填到上限；其余进候补（可关闭）。
4. 组合排序：可成团 → 还差人数少 → 人多 → 待定多 → 时间早。
5. 成团后：名单成员退出 → 重新检查人数与角色 → 不足时通知发起人（附候补数量）→ 发起人点“补上”从候补补位，或扩大邀请、重新开放。新报名者在名额未满时补进名单，满员进候补。

### 邀请与可见范围

- `link`：持链接可查看与报名（适合发群）；仍可选择好友发站内通知。
- `invited`：只有受邀者（好友 + 圈子成员）、发起人、已回应者可见；其他人只看到标题与“请联系发起人”。
- 扩大邀请：追加一批（wave + 1），只通知新加入的人。批次只有发起人能看到。
- 由“我想玩”转成的活动，自动邀请当初 +1 的人（他们主动表达过兴趣）。

### 通知频率限制（`rateLimit.ts`）

同一 `dedupeKey` 在窗口内只发一次；每类通知每人每 24 小时有上限（例如“想玩”3 条、“还差人”2 条、邀请 6 条）。

---

## 5. H5 与微信小程序的真实限制

| 问题 | 影响 | 当前处理 / 计划 |
|---|---|---|
| **请求域名**：小程序只能请求后台配置的 HTTPS 合法域名，且需 ICP 备案 | 本地 `localhost` 无法直接调试真机 | 计划用 CloudBase 云托管 + `wx.cloud.callContainer`（免配置域名）；`TARO_APP_API_BASE` 已预留 |
| **Intl 时区支持**：部分安卓微信 JS 引擎的 `Intl` 不完整，Luxon 依赖它 | 小程序端本地换算时区可能出错 | 详情页的时间文字已由**服务端**格式化；创建表单里的“本地时间→UTC”换算在小程序端需改为服务端换算或用设备时区（待做） |
| **分享**：小程序不能复制任意网页链接给好友打开 H5 | 分享方式不同 | 详情页已接 `useShareAppMessage` + `openType="share"`（卡片直达详情页）；H5 用复制文字 / Web Share API |
| **登录**：小程序可以拿 openid 静默登录；H5 在微信内置浏览器需公众号网页授权 | 身份绑定方式两端不同 | 当前为访客令牌 + 恢复码；`POST /api/auth/wechat` 明确返回 501 未接入 |
| **通知**：小程序订阅消息需用户每次授权、模板审核；H5 没有可靠推送 | 不能随意“提醒” | 当前只有站内通知；接入时沿用同一套频率限制 |
| **样式**：H5 用 px，小程序 px→rpx（设计稿 375） | 个别 H5 专用选择器（如 `taro-input-core`）在小程序中无效 | 已分开输出目录（`dist/h5`、`dist/weapp`）；小程序构建能通过，**尚未在微信开发者工具/真机中运行验证** |
| **微信内置浏览器打开 H5** | 外链在微信里可能被拦截或提示 | 需要备案域名；国内朋友访问海外服务器也可能慢 → 建议部署在 CloudBase（国内）|
| **跨境访问** | 美国的你与中国的朋友访问同一服务 | 部署在国内节点时，你在美国访问通常可接受；反之国内访问海外服务器不稳定 |
