import type { ZodIssue } from 'zod'
import { english, translate, renderMessage, type Locale, type Message } from '@couju/core'
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto'
import type { PublicUser, User } from '@couju/core'

export class AppError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 429 | 501 | 502,
    readonly code: string,
    readonly displayMessage: Message | string,
  ) {
    super(typeof displayMessage === 'string' ? displayMessage : renderMessage('zh-CN', displayMessage))
  }
}

export const badRequest = (msg: string | Message, code = 'bad_request') => new AppError(400, code, msg)
export const forbidden = (msg: string | Message = '没有权限', code = 'forbidden') => new AppError(403, code, msg)
export const notFound = (msg: string | Message = '找不到了', code = 'not_found') => new AppError(404, code, msg)
export const conflict = (msg: string | Message, code = 'conflict') => new AppError(409, code, msg)

export const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
/** 不易混淆的随机短码，例如活动分享码 */
export function randomCode(len: number, alphabet = CODE_ALPHABET): string {
  const bytes = randomBytes(len)
  let out = ''
  for (let i = 0; i < len; i++) out += alphabet[bytes[i]! % alphabet.length]
  return out
}

export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

/** 恢复码：XXXX-XXXX-XXXX（大写，无易混字符），以 scrypt 加盐哈希保存 */
export function newRecoveryCode(): string {
  const raw = randomCode(12, 'ABCDEFGHJKMNPQRSTUVWXYZ23456789')
  return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`
}
const normalizeCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, '')
export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16)
  const key = scryptSync(normalizeCode(code), salt, 32)
  return `${salt.toString('hex')}:${key.toString('hex')}`
}
export function verifyRecoveryCode(code: string, stored: string): boolean {
  const [saltHex, keyHex] = stored.split(':')
  if (!saltHex || !keyHex) return false
  const key = scryptSync(normalizeCode(code), Buffer.from(saltHex, 'hex'), 32)
  const expected = Buffer.from(keyHex, 'hex')
  return key.length === expected.length && timingSafeEqual(key, expected)
}

export function toPublic(u: User): PublicUser {
  return { id: u.id, handle: u.handle, nickname: u.nickname, avatar: u.avatar, timezone: u.timezone }
}

/** 简单的内存限流（单进程 MVP 足够；多实例部署需换成共享存储） */
export class MemoryRateLimiter {
  private hits = new Map<string, number[]>()
  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}
  check(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs)
    if (list.length >= this.max) {
      this.hits.set(key, list)
      return false
    }
    list.push(now)
    this.hits.set(key, list)
    return true
  }
}

/** Zod's global locale is intentionally untouched: requests may validate concurrently. */
export function validationMessage(issue: ZodIssue | undefined, locale: Locale = 'zh-CN'): string {
  if (!issue) return translate(locale, '输入有误')
  if (Object.prototype.hasOwnProperty.call(english, issue.message)) return translate(locale, issue.message)
  const defaults: Partial<Record<ZodIssue['code'], string>> = {
    invalid_type: '输入类型不正确', invalid_value: '请选择有效选项',
    too_small: '输入太短或数量不足', too_big: '输入太长或数量过多',
    invalid_format: '输入格式不正确', invalid_union: '输入不符合要求',
    not_multiple_of: '请输入有效的倍数', unrecognized_keys: '包含无法识别的字段',
  }
  return translate(locale, defaults[issue.code] ?? issue.message)
}
