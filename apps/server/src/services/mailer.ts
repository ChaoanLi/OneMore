import nodemailer, { type Transporter } from 'nodemailer'
import { DEFAULT_TIMEZONE, quietHoursSendAt, interestVisibleTo, type Interest } from '@couju/core'
import type { OutboxEmail, Store } from '../store'
import { newId } from '../util'

/**
 * 发邮件：先写入发件队列（email_outbox），再由后台按时发送。
 * - 免打扰：按收件人时区 23:00–08:00 不发，顺延到 08:30（验证码除外）。
 * - 失败自动重试（指数退避，最多 5 次），不阻塞用户请求。
 * - 未配置 SMTP 时为演示模式：只打印到服务器日志，不会真的发出。
 */

export interface MailMessage {
  to: string
  subject: string
  text: string
  html: string
  headers?: Record<string, string>
}

export interface MailTransport {
  readonly kind: 'smtp' | 'console'
  send(m: MailMessage): Promise<void>
}

/** 演示模式：不真的发信，打印到日志并保留在内存里（测试用） */
export class ConsoleTransport implements MailTransport {
  readonly kind = 'console' as const
  readonly sent: MailMessage[] = []
  constructor(private readonly log = true) {}
  async send(m: MailMessage) {
    this.sent.push(m)
    if (this.log) console.log(`\n📧 [演示模式，未真的发出] To: ${m.to}\n   Subject: ${m.subject}\n   ${m.text.split('\n').join('\n   ')}\n`)
  }
}

export class SmtpTransport implements MailTransport {
  readonly kind = 'smtp' as const
  private readonly transporter: Transporter
  constructor(
    opts: { host: string; port: number; user?: string; pass?: string; secure?: boolean },
    private readonly from: string,
  ) {
    this.transporter = nodemailer.createTransport({
      host: opts.host,
      port: opts.port,
      secure: opts.secure ?? opts.port === 465,
      auth: opts.user ? { user: opts.user, pass: opts.pass } : undefined,
    })
  }
  async send(m: MailMessage) {
    await this.transporter.sendMail({ from: this.from, to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers })
  }
}

export function transportFromEnv(env: NodeJS.ProcessEnv = process.env): MailTransport {
  if (env.SMTP_HOST) {
    const port = Number(env.SMTP_PORT || 465)
    const from = env.MAIL_FROM || `算我一个 <${env.SMTP_USER}>`
    return new SmtpTransport(
      { host: env.SMTP_HOST, port, user: env.SMTP_USER, pass: env.SMTP_PASS, secure: env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : undefined },
      from,
    )
  }
  return new ConsoleTransport()
}

export class Mailer {
  private flushing = false
  constructor(
    private readonly store: Store,
    readonly transport: MailTransport,
    private readonly now: () => Date,
    readonly baseUrl: string,
    private readonly autoFlush = true,
  ) {}

  enqueue(msg: MailMessage & { kind: string }, opts: { recipientTz?: string; immediate?: boolean; spaceId?: string; recipientId?: string; objectCode?: string; interestId?: string } = {}): OutboxEmail {
    const now = this.now()
    const sendAfter = opts.immediate ? now : quietHoursSendAt(now, opts.recipientTz ?? DEFAULT_TIMEZONE)
    const item: OutboxEmail = {
      id: newId('m'),
      spaceId: opts.spaceId, recipientId: opts.recipientId, objectCode: opts.objectCode, interestId: opts.interestId,
      membershipJoinedAt: opts.spaceId && opts.recipientId ? this.store.getMembership(opts.spaceId,opts.recipientId)?.joinedAt : undefined,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      headers: msg.headers ?? {},
      status: 'queued',
      sendAfter: sendAfter.toISOString(),
      attempts: 0,
      lastError: null,
      kind: msg.kind,
      createdAt: now.toISOString(),
      sentAt: null,
    }
    this.store.enqueueEmail(item)
    if (this.autoFlush && sendAfter.getTime() <= now.getTime()) setTimeout(() => void this.flush(), 0)
    return item
  }

  private maySend(m: OutboxEmail): boolean {
    if(m.kind==='verify') return true
    if(!m.spaceId||!m.recipientId) return false
    const membership=this.store.getMembership(m.spaceId,m.recipientId)
    const email=this.store.getUserEmail(m.recipientId)
    if(!membership||membership.joinedAt!==m.membershipJoinedAt||!membership.emailEnabled||!email?.enabled||email.email!==m.to||this.store.isSuppressed(m.to)) return false
    const store=this.store.forSpace(m.spaceId)
    if(m.objectCode) { const e=store.getEventByCode(m.objectCode); if(!e) return false; if(e.visibility!=='link'&&e.hostId!==m.recipientId&&!e.invitations.some(i=>i.userId===m.recipientId)&&!store.getResponse(e.id,m.recipientId)) return false }
    if(m.interestId) {
      const i=store.getInterest(m.interestId); if(!i) return false
      const friends=new Set(store.friendIds(i.ownerId)), favorites=new Set(store.getPrefs(i.ownerId).filter(p=>p.favorite).map(p=>p.friendId))
      const circles=new Set(i.audience.kind==='circles'?i.audience.circleIds.flatMap(id=>store.getCircle(id)?.memberIds??[]):[])
      if(i.ownerId!==m.recipientId&&!i.joiners.some(j=>j.userId===m.recipientId)&&!interestVisibleTo(i,m.recipientId,{ownerFriendIds:friends,ownerFavoriteIds:favorites,circleMemberIds:circles})) return false
    }
    return true
  }

  /** 发送所有到期的邮件，返回成功数量 */
  async flush(): Promise<number> {
    if (this.flushing) return 0
    this.flushing = true
    let ok = 0
    try {
      for (const m of this.store.dueEmails(this.now().toISOString())) {
        try {
          if(!this.maySend(m)) { this.store.saveOutbox({...m,status:'failed',lastError:'permission_revoked'}); continue }
          await this.transport.send({ to: m.to, subject: m.subject, text: m.text, html: m.html, headers: m.headers })
          this.store.saveOutbox({ ...m, status: 'sent', sentAt: this.now().toISOString(), attempts: m.attempts + 1, lastError: null })
          ok++
        } catch (e) {
          const attempts = m.attempts + 1
          const retryAt = new Date(this.now().getTime() + 2 ** attempts * 60_000).toISOString()
          this.store.saveOutbox({
            ...m,
            attempts,
            status: attempts >= 5 ? 'failed' : 'queued',
            sendAfter: attempts >= 5 ? m.sendAfter : retryAt,
            lastError: e instanceof Error ? e.message.slice(0, 300) : String(e),
          })
          console.error(`邮件发送失败（第 ${attempts} 次）→ ${m.to}:`, e instanceof Error ? e.message : e)
        }
      }
    } finally {
      this.flushing = false
    }
    return ok
  }
}

// ---------- 模板（与 App 同一套视觉：白底、黑字、一抹红） ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function renderEmail(p: {
  heading: string
  lines: string[]
  cta?: { text: string; url: string }
  footer: string
  unsubUrl?: string
}): { text: string; html: string } {
  const text = [
    p.heading,
    '',
    ...p.lines,
    ...(p.cta ? ['', `${p.cta.text}：${p.cta.url}`] : []),
    '',
    '—',
    p.footer,
    ...(p.unsubUrl ? [`不想再收到这类邮件：${p.unsubUrl}`] : []),
  ].join('\n')

  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff;">
<div style="max-width:480px;margin:0 auto;padding:28px 22px;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;color:#1f1f1f;line-height:1.6;">
  <div style="font-size:15px;font-weight:800;color:#ff2b2b;letter-spacing:1px;">算我一个 <span style="color:#a8a8a8;font-weight:600;letter-spacing:2px;">OneMore</span></div>
  <div style="margin-top:18px;font-size:22px;font-weight:700;color:#141414;">${esc(p.heading)}</div>
  ${p.lines.map((l) => `<div style="margin-top:8px;font-size:15px;color:#4a4a4a;">${esc(l)}</div>`).join('')}
  ${
    p.cta
      ? `<div style="margin-top:24px;"><a href="${esc(p.cta.url)}" style="display:inline-block;padding:12px 26px;border-radius:999px;background:#141414;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;">${esc(p.cta.text)}</a></div>`
      : ''
  }
  <div style="margin-top:32px;padding-top:14px;border-top:1px solid #ececec;font-size:12px;color:#a8a8a8;">
    ${esc(p.footer)}${p.unsubUrl ? `<br><a href="${esc(p.unsubUrl)}" style="color:#a8a8a8;">不想再收到这类邮件</a>` : ''}
  </div>
</div></body></html>`
  return { text, html }
}
