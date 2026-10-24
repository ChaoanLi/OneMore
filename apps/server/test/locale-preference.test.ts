import { describe, expect, it } from 'vitest'
import { chooseLocale, formatClientMessage, localizeBuiltin } from '../../client/src/lib/localePreference'
describe('语言偏好与用户内容', () => {
  it('账号显式偏好优先，其次本机选择，再按设备语言；语言不推断时区', () => {
    expect(chooseLocale({ account: 'zh-CN', local: 'en', device: 'en-US' })).toBe('zh-CN')
    expect(chooseLocale({ local: 'en', device: 'zh-TW' })).toBe('en')
    expect(chooseLocale({ device: 'zh-TW' })).toBe('zh-CN')
    expect(chooseLocale({ device: 'fr-FR' })).toBe('en')
    expect(chooseLocale({})).toBe('en')
  })
  it('只翻译明确的系统模板和未改名的内置游戏，不扫描用户内容', () => {
    expect(formatClientMessage('Invite {0} to {1}', ['林 & Alice', '周末中文组'])).toBe('Invite 林 & Alice to 周末中文组')
    expect(localizeBuiltin({ gameKey: 'riichi', name: '日麻' }, 'en').name).toBe('Riichi mahjong')
    expect(localizeBuiltin({ gameKey: 'riichi', name: '老李的麻将之夜' }, 'en').name).toBe('老李的麻将之夜')
    expect(localizeBuiltin({ gameKey: null, name: '私人中文游戏' }, 'en').name).toBe('私人中文游戏')
    expect(localizeBuiltin({ key: 'boardgame', name: 'Board games' }, 'zh-CN').name).toBe('桌游')
  })
})
