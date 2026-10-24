// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
const lifecycle = vi.hoisted(() => ({ show: () => {}, hide: () => {} }))
vi.mock('@tarojs/taro', () => ({
  useDidShow: (callback: () => void) => {
    lifecycle.show = callback
  },
  useDidHide: (callback: () => void) => {
    lifecycle.hide = callback
  },
  default: { getStorageSync: () => 'en', getSystemInfoSync: () => ({ language: 'en-US' }) },
}))
import { applyLocale, useLocaleDidShow } from '../../client/src/lib/i18n'
let root: Root | undefined
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => {
  if (root) act(() => root!.unmount())
  root = undefined
  applyLocale('en')
})
describe('cached-page locale lifecycle', () => {
  it('refreshes a visible page but waits for show before loading a hidden page again', () => {
    const load = vi.fn()
    function Page() {
      useLocaleDidShow(load)
      return createElement('div', null, 'Demo')
    }
    root = createRoot((globalThis as any).document.createElement('div'))
    act(() => root!.render(createElement(Page)))
    expect(load).not.toHaveBeenCalled()
    act(() => lifecycle.show())
    expect(load).toHaveBeenCalledTimes(1)
    act(() => applyLocale('zh-CN'))
    expect(load).toHaveBeenCalledTimes(2)
    act(() => lifecycle.hide())
    act(() => applyLocale('en'))
    expect(load).toHaveBeenCalledTimes(2)
    act(() => lifecycle.show())
    expect(load).toHaveBeenCalledTimes(3)
  })
})
