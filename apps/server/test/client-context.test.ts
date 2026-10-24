import { describe, expect, it } from 'vitest'
import { RequestContext } from '../../client/src/lib/requestContext'
import { setPrefill, takePrefill } from '../../client/src/lib/draftStore'
import { requestContext } from '../../client/src/lib/requestContext'
import { makePageUrl } from '../../client/src/lib/pageUrl'

describe('客户端空间切换', () => {
  it('跨空间分享跳转剔除 Taro 内部参数，避免双问号导致活动短码丢失', () => {
    expect(makePageUrl('/pages/event/detail?stamp=AD', { code: 'abc', space: 'B', stamp: 'AD', $taroTimestamp: '123' })).toBe(
      '/pages/event/detail?code=abc&space=B',
    )
  })
  it('空间切换、退出及更换账号使旧请求失效', () => {
    const ctx = new RequestContext()
    ctx.setIdentity('accountA')
    ctx.setSpace('A')
    const old = ctx.capture()
    ctx.setSpace('B')
    expect(ctx.isCurrent(old)).toBe(false)
    const b = ctx.capture()
    ctx.setIdentity(null)
    expect(ctx.isCurrent(b)).toBe(false)
    expect(ctx.capture().spaceId).toBe(null)
    ctx.setIdentity('accountB')
    ctx.setSpace('B')
    expect(ctx.isCurrent(b)).toBe(false)
  })
  it('切换空间后不能取到旧空间的 AI 或活动预填草稿', () => {
    requestContext.setIdentity('accountA')
    requestContext.setSpace('A')
    const draft = { source: 'interest', interest: { id: 'private-A' } } as any
    setPrefill(draft)
    requestContext.setSpace('B')
    expect(takePrefill()).toBe(null)
    setPrefill(draft)
    expect(takePrefill()).toEqual(draft)
    expect(takePrefill()).toBe(null)
  })
})
