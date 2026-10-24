import { describe, expect, it } from 'vitest'
import { clientEnglish } from '../../client/src/lib/locales/en'

// Missing or malformed templates would leak system Chinese or lose user values.
describe('client English source templates', () => {
  it('provides English for signed-out access, loading, and sharing', () => {
    for (const key of ['先选择一个空间', '恢复已有账号', '加载中…', '叫上朋友', '把「下次一定」变成这次。']) {
      expect(clientEnglish[key], key).toBeTypeOf('string')
      expect(clientEnglish[key], key).not.toMatch(/\p{Script=Han}/u)
    }
  })
  it('preserves indexed arguments without interpreting user content', () => {
    const template = clientEnglish['最多 {0} 个时间']
    expect(template).toBeDefined()
    expect(template!.replace('{0}', '12')).toBe('Up to 12 times')
  })
  it('keeps each template argument in the translated template', () => {
    expect(Object.keys(clientEnglish).length).toBeGreaterThan(100)
    for (const [key, value] of Object.entries(clientEnglish)) {
      const indices = (text: string) => [...text.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort()
      expect(indices(value), key).toEqual(indices(key))
      expect(value, key).not.toMatch(/\p{Script=Han}/u)
    }
  })
})

import { isWeekendLocalDate } from '../../client/src/lib/localeCalendar'
describe('language-independent weekend shortcuts', () => {
  it('selects Saturday and Sunday using viewer-local dates', () => {
    expect(isWeekendLocalDate('2026-10-24')).toBe(true)
    expect(isWeekendLocalDate('2026-10-25')).toBe(true)
    expect(isWeekendLocalDate('2026-10-23')).toBe(false)
    expect(isWeekendLocalDate('2026-10-26')).toBe(false)
  })
})

import { shouldSelectLinkedSpace } from '../../client/src/lib/pageVisibility'
describe('cached page space selection', () => {
  const page = {
    visible: true,
    switching: false,
    global: false,
    ready: true,
    linked: 'space-A',
    activeSpace: 'space-B',
    memberSpaceIds: ['space-A', 'space-B'],
  }
  it('does not restore a hidden detail page space after switching in management', () => {
    expect(shouldSelectLinkedSpace({ ...page, visible: false })).toBe(false)
    expect(shouldSelectLinkedSpace({ ...page, switching: true })).toBe(false)
    expect(shouldSelectLinkedSpace(page)).toBe(true)
  })
  it('only selects joined linked spaces on a ready, visible, nonglobal page', () => {
    expect(shouldSelectLinkedSpace({ ...page, ready: false })).toBe(false)
    expect(shouldSelectLinkedSpace({ ...page, global: true })).toBe(false)
    expect(shouldSelectLinkedSpace({ ...page, activeSpace: 'space-A' })).toBe(false)
    expect(shouldSelectLinkedSpace({ ...page, linked: 'not-a-member' })).toBe(false)
    expect(shouldSelectLinkedSpace({ ...page, linked: undefined })).toBe(false)
  })
})
