import { beforeEach, describe, expect, it, vi } from 'vitest'
const network = vi.hoisted(() => ({
  finish: null as null | ((value: any) => void),
  fail: null as null | ((reason: unknown) => void),
  routeSpace: undefined as string | undefined,
  request: vi.fn(),
}))
vi.mock('@tarojs/taro', () => ({
  default: { request: network.request, getCurrentInstance: () => ({ router: { params: { space: network.routeSpace } } }) },
}))
import { get, setApiToken } from '../../client/src/lib/api'
import { requestContext } from '../../client/src/lib/requestContext'
beforeEach(() => {
  network.routeSpace = undefined
  network.request.mockReset()
  network.request.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        network.finish = resolve
        network.fail = reject
      }),
  )
  setApiToken(null)
})
describe('实际 HTTP 客户端的空间边界', () => {
  it.each(['locale', 'account', 'space'] as const)('丢弃 %s 切换后才到达的网络失败', async (change) => {
    setApiToken('old-account')
    requestContext.setSpace('A')
    requestContext.setLocale('zh-CN')
    const pending = get('/api/events')
    if (change === 'locale') requestContext.setLocale('en')
    if (change === 'account') setApiToken('new-account')
    if (change === 'space') requestContext.setSpace('B')
    network.fail!(new Error('transport disconnected'))
    await expect(pending).rejects.toMatchObject({ code: 'stale_context' })
  })
  it('当前上下文的网络失败仍使用请求语言', async () => {
    setApiToken('current-account')
    requestContext.setSpace('A')
    requestContext.setLocale('en')
    const pending = get('/api/events')
    network.fail!(new Error('transport disconnected'))
    await expect(pending).rejects.toMatchObject({ code: 'network', message: 'Connection trouble. Please try again.' })
  })
  it('语言切换使旧语言的响应失效，并发送明确的请求语言', async () => {
    setApiToken('locale-account')
    requestContext.setSpace('A')
    requestContext.setLocale('zh-CN')
    const pending = get('/api/events')
    expect(network.request.mock.calls[0]![0].header['Accept-Language']).toBe('zh-CN')
    requestContext.setLocale('en')
    network.finish!({ statusCode: 200, data: { active: [{ statusText: '招人中' }] } })
    await expect(pending).rejects.toMatchObject({ code: 'stale_context' })
    expect(requestContext.capture().spaceId).toBe('A')
    const english = get('/api/events')
    expect(network.request.mock.calls[1]![0].header['Accept-Language']).toBe('en')
    network.finish!({ statusCode: 200, data: { active: [] } })
    await expect(english).resolves.toEqual({ active: [] })
  })
  it('发出 A 请求后切到 B，A 的成功响应被丢弃', async () => {
    setApiToken('test-A')
    requestContext.setSpace('A')
    const pending = get('/api/events')
    expect(network.request.mock.calls[0]![0].header['X-Space-Id']).toBe('A')
    requestContext.setSpace('B')
    network.finish!({ statusCode: 200, data: { title: 'A的私密活动' } })
    await expect(pending).rejects.toMatchObject({ code: 'stale_context' })
  })
  it('退出账号后丢弃在途账号响应；跨空间深链接不向错误空间发请求', async () => {
    setApiToken('test-A')
    requestContext.setSpace('A')
    const pending = get('/api/me')
    setApiToken(null)
    network.finish!({ statusCode: 200, data: { user: { id: 'old-account' } } })
    await expect(pending).rejects.toMatchObject({ code: 'stale_context' })
    setApiToken('test-B')
    requestContext.setSpace('B')
    network.routeSpace = 'A'
    await expect(get('/api/events/oldcode')).rejects.toMatchObject({ code: 'stale_context' })
    expect(network.request).toHaveBeenCalledTimes(1)
  })
})
