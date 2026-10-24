import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { existsSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app'
import { Store } from './store'
import { sweepExpiredInterests } from './services/interests'

const here = dirname(fileURLToPath(import.meta.url))
// 可选：读取项目根目录的 .env（DEEPSEEK_API_KEY 等），文件不存在时忽略
const envFile = resolve(here, '../../../.env')
if (existsSync(envFile)) process.loadEnvFile(envFile)
const port = Number(process.env.PORT || 8787)
const dbPath = process.env.DB_PATH || resolve(here, '../data/couju.db')
const clientDist = resolve(here, '../../client/dist/h5')

const store = new Store(dbPath)
const { app, ctx } = createApp({ store })

// 生产模式：同一端口直接提供 H5 静态文件（先 npm run build）
if (existsSync(join(clientDist, 'index.html'))) {
  const root = relative(process.cwd(), clientDist)
  app.use('/*', serveStatic({ root }))
  app.get('/', serveStatic({ path: join(root, 'index.html') }))
}

const sweep = () => store.allSpaces().reduce((n,s)=>n+sweepExpiredInterests({...ctx,store:store.forSpace(s.id)}),0)
const swept = sweep()
setInterval(sweep, 3600_000).unref()
// 发件队列：每 30 秒发送到期的邮件（含夜间顺延、失败重试）
setInterval(() => void ctx.mailer?.flush(), 30_000).unref()
void ctx.mailer?.flush()

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  const lan = Object.values(networkInterfaces())
    .flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address
  console.log(`邮件：${ctx.mailer?.transport.kind === 'smtp' ? 'SMTP 已配置，会真的发出' : '演示模式（未配置 SMTP，邮件只打印在这里）'}`)
  console.log(`算我一个 API 已启动: http://localhost:${port}  (数据库: ${dbPath}${swept ? `，清理过期想玩 ${swept} 条` : ''})`)
  if (existsSync(join(clientDist, 'index.html'))) {
    console.log(`H5 页面: http://localhost:${port}${lan ? `  局域网: http://${lan}:${port}` : ''}`)
  } else {
    console.log('未找到 H5 构建产物；开发时请用 npm run dev（H5 开发服务器会代理 /api）')
  }
})
