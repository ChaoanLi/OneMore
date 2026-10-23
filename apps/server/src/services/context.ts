import type { Store } from '../store'
import type { Mailer } from './mailer'

/** 服务层上下文：数据存储 + 可注入的时钟（测试时固定时间） */
export interface Ctx {
  store: Store
  now: () => Date
  /** 邮件（可选；未提供时不发邮件） */
  mailer?: Mailer
}
