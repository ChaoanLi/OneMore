# 算我一个 · OneMore

> 代码里的内部名仍是 `couju`（npm 包名 `@couju/*`、本地存储键），用户看不到；产品名集中在 `apps/client/src/lib/brand.ts`。

熟人轻社交组局：发起一局 → 把链接发给朋友 → 朋友填个昵称就能报名、选空闲时间 → 系统判断同一时段人数与角色是否满足 → 发起人确认开局。

设计文档（信息架构、MVP 范围、技术选型、数据模型与状态机、小程序限制）：[docs/DESIGN.md](docs/DESIGN.md)

部署到自己的域名（Docker + 自动 HTTPS + 域名邮箱发提醒）：[docs/DEPLOY.md](docs/DEPLOY.md)

## 当前状态（如实标注）

| 模块 | 状态 |
|---|---|
| H5 客户端（Taro + React + TS，手机优先） | ✅ 可运行，已用浏览器走通完整验收流程 |
| 后端 API（Hono + Node 内置 SQLite） | ✅ 可运行，有集成测试 |
| 用户身份：访客（昵称即可）、自定义 ID、恢复码绑定/恢复 | ✅ |
| 好友、常玩（私密）、圈子（私密） | ✅ |
| 活动：多候选玩法、自定义玩法、人数上下限、候补、KP/GM、多候选时段 | ✅ |
| 报名：想玩 / 待定 / 报名 / 这次不了、最终确认、退出、候补补位 | ✅ |
| 可见范围（链接 / 仅邀请）、分批扩大邀请 | ✅ |
| 成团规则引擎、发起人确认、取消、重新开放、自动过期 | ✅ |
| 视觉与文案：参考 Nice Try（白底、黑灰分层、一抹红、手绘歪框、胶囊按钮、俏皮文案） | ✅ |
| 提前排几周：一键“未来 4 个周末晚上”等，或自选周数/星期几/时间（最多 24 个候选时间）；朋友端“全都可以/周末都行”一键勾选；AI 能听懂“未来一个月的周末” | ✅ |
| 日历：应用内月历（成了 / 等你回话 / 已回话）；订阅到手机日历（ICS，iPhone/Google/Outlook，成团自动出现、取消/重新开放自动同步；链接可重新生成作废） | ✅ |
| 邮件提醒：用户验证邮箱后，站内提醒同时发邮件（限频 + 按收件人时区夜间顺延到 08:30）；组局人可用邮件邀请没用过 App 的朋友（去重、限额、一键退订）；发件队列失败重试 | ✅（未配置 SMTP 时为演示模式，只打印日志） |
| 我的游戏：首次使用时选常玩的游戏；可自己添加（名字/图标/人数/是否需要 KP），也能改内置游戏的默认人数；组局和举手只显示自己的游戏 | ✅ |
| 界面：线条图标（Lucide，ISC 许可）+ 少文字；次要设置收进弹层 | ✅ |
| 时区：UTC 存储、IANA 时区、跨日、夏令时（含 2026-11-01 美国切换的测试） | ✅ |
| 我想玩：可见范围、+1、过期、人够提醒、转为正式活动 | ✅ |
| 站内通知 + 频率限制 | ✅ |
| AI 一句话组局 | 🟡 接口完整；默认是**演示解析（关键词规则，不是 AI）**。DeepSeek 适配器已写好，**未用真实 Key 联调** |
| 微信小程序 | 🟡 `npm run build:weapp` 能编译通过，**未在微信开发者工具或真机运行过** |
| 微信登录、订阅消息推送 | ⛔ 未接入（`/api/auth/wechat` 返回 501）；邮件已可用，见上 |
| 腾讯云 CloudBase | ⛔ 未接入，当前为本地 SQLite（迁移方式见下文） |

## 快速开始

需要 Node.js ≥ 22.13（用到内置 `node:sqlite`；本项目在 Node 24 上开发）。

```bash
npm install
npm run seed      # 可选：创建 5 个演示用户（中美时区）、好友、圈子、一个活动、一条“想玩”
npm run dev       # API :8787 + H5 开发服务器 :10086（/api 自动代理）
```

打开 http://localhost:10086 。

### 给朋友真的用一下

```bash
npm run build     # 构建 H5 到 apps/client/dist/h5
npm start         # 一个端口同时提供 H5 和 API：http://localhost:8787
```

启动日志会打印局域网地址（例如 `http://192.168.x.x:8787`），同一 Wi-Fi 下的手机可直接打开。
要让中国的朋友访问，需要把服务部署到公网（推荐国内节点，见“CloudBase 迁移”），或临时用内网穿透工具。

### 用演示账号模拟“朋友报名”

`npm run seed` 会打印每个演示用户的 ID 和恢复码。在另一个浏览器或无痕窗口打开页面，进入“我的 → 恢复账号”登录，就能以朋友身份报名。
也可以直接用无痕窗口打开活动链接，填一个新昵称报名（这就是真实朋友的体验）。

重置数据：删除 `apps/server/data/couju.db`。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发：API（tsx watch）+ H5（Taro watch） |
| `npm run build` | 构建 core 与 H5 |
| `npm start` | 先构建 H5，再启动 API 并托管页面（`npm run dev` 会清空 H5 构建目录，所以 start 每次都会重新构建） |
| `npm test` | 运行全部自动化测试（core 53 个 + API 30 个） |
| `npm run typecheck` | core / server / client 三端类型检查 |
| `npm run seed` | 写入演示数据 |
| `npm run build:weapp -w @couju/client` | 构建微信小程序到 `apps/client/dist/weapp`（未实机验证） |

## 项目结构

```
packages/core     领域模型（前后端共用）
  src/types.ts        实体类型
  src/schemas.ts      zod 输入校验
  src/time.ts         时区、夏令时、相对日期、候选时段生成
  src/quorum.ts       成团规则引擎（同一时段 + 人数 + 角色匹配 + 名单/候补）
  src/eventState.ts   活动状态机
  src/rateLimit.ts    通知频率限制
  src/interest.ts     “我想玩”规则
  src/ai/             AI 草稿结构、演示解析器、DeepSeek 提示词
  src/api.ts          HTTP 响应类型（前后端契约）
apps/server       API（Hono）
  src/store.ts        数据访问层（SQLite；替换为 CloudBase 时实现同样的方法）
  src/services/       用户、好友圈子、活动、我想玩、通知
  src/ai/providers.ts 演示解析 / DeepSeek 适配器
  test/api.test.ts    集成测试（含完整验收流程、隐私、候补、AI 失败兜底）
apps/client       Taro 客户端
  src/pages/          首页、发起一局、活动详情、我想玩、一句话组局、好友、加好友、圈子、我的、通知
  src/components/     页面外壳（含“怎么称呼你”弹层）、时段编辑器、基础组件
  src/lib/            API、会话、提示
```

## 环境变量

复制 `.env.example` 为根目录 `.env`（API 启动时自动读取）：

| 变量 | 说明 |
|---|---|
| `PORT` | API 端口，默认 8787 |
| `DB_PATH` | SQLite 文件路径，默认 `apps/server/data/couju.db` |
| `DEEPSEEK_API_KEY` | 配置后 AI 组局改用 DeepSeek；**只放在后端** |
| `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL` | 默认 `https://api.deepseek.com` / `deepseek-chat` |
| `PUBLIC_URL` | 公网地址（例如 https://onemore.example.com），用于日历订阅里的活动链接；不填则用请求的 Host |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `MAIL_FROM` | 发邮件用的 SMTP（QQ/163/Gmail/Outlook 示例见 `.env.example`）；不填为演示模式 |
| `AI_PROVIDER=mock` | 即使有 Key 也强制使用演示解析 |
| `TARO_APP_API_BASE`（客户端 `.env.*`） | H5 同源时留空；小程序需要填 HTTPS 域名 |

## AI 模块边界

- AI（或演示解析）只输出草稿：候选玩法、相对时间关键词、时段偏好、人数、邀请策略、不确定字段。
- 具体日期和候选时段由确定性代码根据用户时区生成；成团判断只由规则引擎做。
- AI 不会创建活动、不会邀请任何人：草稿进入表单，邀请对象只是预选，用户点“创建”后才生效。
- DeepSeek 输出经过 zod 严格校验；网络失败、超时（15 秒）、格式不对都返回 502，页面提示“直接填表单”。
- 接入真实 Key 后建议先跑几十条真实句子，对照 `packages/core/test/ai.test.ts` 的用例检查。

## CloudBase 迁移（未做，思路）

1. **运行环境**：`apps/server` 是普通 Node HTTP 服务，可直接打包成容器部署到 CloudBase **云托管**；小程序端用 `wx.cloud.callContainer` 调用，免配置合法域名。
2. **数据**：实现一个 `CloudBaseStore`，提供与 `apps/server/src/store.ts` 相同的方法。现有表本来就是“文档 JSON + 少量索引字段”，可一一映射到文档数据库集合（`events`、`responses`……）。`tx()` 需要换成 CloudBase 事务或按文档设计幂等写入。
3. **限流**：`MemoryRateLimiter` 只适合单实例，多实例时改用数据库或 Redis。
4. **定时任务**：“想玩”过期清理目前是进程内 `setInterval`，迁移后改用云函数定时触发器。

## 已知限制

- 单进程 SQLite，适合朋友圈规模；没有做多实例部署。
- 访客令牌长期有效，没有过期与设备管理。
- 活动创建后暂不支持修改玩法和人数（可以加时间、扩大邀请、重新开放、取消）。
- 小程序端：创建表单的本地时间→UTC 换算依赖 `Intl` 时区数据，部分安卓微信环境可能不支持（详情页显示不受影响，由服务端格式化）。
- 没有深色模式。
