import { beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app'
import { Store } from '../src/store'
import { ConsoleTransport, Mailer } from '../src/services/mailer'
import { wechatFromEnv, type WechatAuth } from '../src/services/wechat'
import { AppError } from '../src/util'

const now = new Date('2026-10-24T05:00:00Z')
// 测试用微信：code "c:<openid>" 换出对应 openid，"bad" 模拟过期 code
const fakeWechat: WechatAuth = {
  async code2Session(code) {
    if (!code.startsWith('c:')) throw new AppError(400, 'invalid_wechat_code', '微信登录已过期，请重试')
    return { openid: code.slice(2) }
  },
}

let app: ReturnType<typeof createApp>['app']
function setup(wechat: WechatAuth | null = fakeWechat) {
  const store = new Store(':memory:')
  const mailer = new Mailer(store, new ConsoleTransport(false), () => now, 'https://onemore.test', false)
  app = createApp({ store, now: () => now, mailer, wechat }).app
}

async function call<T = any>(method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, data: (await res.json()) as T }
}

const profile = { nickname: '小明', timezone: 'Asia/Shanghai' }

describe('微信小程序登录', () => {
  beforeEach(() => setup())

  it('没配置 AppID 时返回 501', async () => {
    setup(null)
    const r = await call('POST', '/api/auth/wechat', undefined, { code: 'c:o1' })
    expect(r.status).toBe(501)
  })

  it('新微信先要资料，带上昵称后建号；之后同一个微信静默登录到同一个账号', async () => {
    const first = await call('POST', '/api/auth/wechat', undefined, { code: 'c:o1' })
    expect(first.data).toEqual({ status: 'needs_profile' })

    const created = await call('POST', '/api/auth/wechat', undefined, { code: 'c:o1', profile })
    expect(created.data.status).toBe('signed_in')
    expect(created.data.user.nickname).toBe('小明')

    const again = await call('POST', '/api/auth/wechat', undefined, { code: 'c:o1' })
    expect(again.data.status).toBe('signed_in')
    expect(again.data.user.id).toBe(created.data.user.id)
    expect(again.data.token).not.toBe(created.data.token)
    const me = await call('GET', '/api/me', again.data.token)
    expect(me.data.user.id).toBe(created.data.user.id)
  })

  it('H5 老账号登录后可以绑定微信，之后用微信直接进老账号', async () => {
    const guest = (await call('POST', '/api/auth/guest', undefined, profile)).data
    const bound = await call('POST', '/api/auth/wechat', guest.token, { code: 'c:o2' })
    expect(bound.data).toMatchObject({ status: 'bound', user: { id: guest.user.id } })
    // 重复绑定同一个微信不报错
    expect((await call('POST', '/api/auth/wechat', guest.token, { code: 'c:o2' })).status).toBe(200)

    const login = await call('POST', '/api/auth/wechat', undefined, { code: 'c:o2' })
    expect(login.data.user.id).toBe(guest.user.id)
  })

  it('一个微信只能绑一个账号，一个账号也只能绑一个微信', async () => {
    const a = (await call('POST', '/api/auth/guest', undefined, profile)).data
    const b = (await call('POST', '/api/auth/guest', undefined, { ...profile, nickname: '小红' })).data
    await call('POST', '/api/auth/wechat', a.token, { code: 'c:o3' })

    const taken = await call('POST', '/api/auth/wechat', b.token, { code: 'c:o3' })
    expect(taken.status).toBe(409)
    expect(taken.data.error).toBe('wechat_bound_elsewhere')

    const second = await call('POST', '/api/auth/wechat', a.token, { code: 'c:o4' })
    expect(second.status).toBe(409)
    expect(second.data.error).toBe('account_bound_elsewhere')
  })

  it('code 无效时给出可读错误，不建号', async () => {
    const r = await call('POST', '/api/auth/wechat', undefined, { code: 'bad', profile })
    expect(r.status).toBe(400)
    expect(r.data.error).toBe('invalid_wechat_code')
  })

  it('只有同时配置 AppID 和 AppSecret 才启用', () => {
    expect(wechatFromEnv({})).toBeUndefined()
    expect(wechatFromEnv({ WECHAT_APPID: 'wx123' })).toBeUndefined()
    expect(wechatFromEnv({ WECHAT_APPID: 'wx123', WECHAT_SECRET: 's' })).toBeDefined()
  })
})
