import { describe, expect, it } from 'vitest'
import { RequestContext } from '../../client/src/lib/requestContext'
import { setPrefill, takePrefill } from '../../client/src/lib/draftStore'
import { requestContext } from '../../client/src/lib/requestContext'

describe('客户端空间切换', () => {
  it('空间切换、退出及更换账号使旧请求失效', () => {
    const ctx=new RequestContext()
    ctx.setIdentity('accountA'); ctx.setSpace('A')
    const old=ctx.capture()
    ctx.setSpace('B')
    expect(ctx.isCurrent(old)).toBe(false)
    const b=ctx.capture(); ctx.setIdentity(null)
    expect(ctx.isCurrent(b)).toBe(false)
    expect(ctx.capture().spaceId).toBe(null)
    ctx.setIdentity('accountB'); ctx.setSpace('B')
    expect(ctx.isCurrent(b)).toBe(false)
  })
  it('切换空间后不能取到旧空间的 AI 或活动预填草稿', () => {
    requestContext.setIdentity('accountA'); requestContext.setSpace('A')
    const draft={source:'interest',interest:{id:'private-A'}} as any
    setPrefill(draft)
    requestContext.setSpace('B')
    expect(takePrefill()).toBe(null)
    setPrefill(draft)
    expect(takePrefill()).toEqual(draft)
    expect(takePrefill()).toBe(null)
  })
})
