import { beforeEach, describe, expect, it, vi } from 'vitest'
const network = vi.hoisted(() => ({
  finish: null as null | ((value: any) => void),
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
  network.request.mockImplementation(() => new Promise((resolve) => (network.finish = resolve)))
  setApiToken(null)
})
describe('实际 HTTP 客户端的空间边界', () => {
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
