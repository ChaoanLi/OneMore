import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useReducer, useRef } from 'react'
import { translate } from '@couju/core'
import { clientEnglish } from './locales/en'
import { chooseLocale, formatClientMessage, localizeBuiltin, type Locale } from './localePreference'
import { requestContext } from './requestContext'

export type { Locale } from './localePreference'
const STORAGE_KEY = 'onemore.locale'
const environment = globalThis as unknown as { navigator?: { language?: string }; document?: { documentElement: { lang: string } } }
const listeners = new Set<() => void>()
let saved: unknown
let device: string | undefined
try {
  saved = Taro.getStorageSync(STORAGE_KEY)
} catch {
  /* unavailable storage */
}
try {
  device = Taro.getSystemInfoSync().language
} catch {
  /* unavailable device information */
}
if (!device) device = environment.navigator?.language
let locale = chooseLocale({ local: saved, device })
requestContext.setLocale(locale)
if (environment.document) environment.document.documentElement.lang = locale
let persist: ((next: Locale) => Promise<void>) | undefined

export function getLocale(): Locale {
  return locale
}
export function applyLocale(next: Locale): void {
  if (locale === next) return
  locale = next
  requestContext.setLocale(next)
  if (environment.document) environment.document.documentElement.lang = next
  listeners.forEach((listener) => listener())
}
export function setLocalePersistence(handler: (next: Locale) => Promise<void>): void {
  persist = handler
}
export async function setLocale(next: Locale): Promise<void> {
  Taro.setStorageSync(STORAGE_KEY, next)
  applyLocale(next)
  await persist?.(next)
}
export function useLocale(): Locale {
  const [, force] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    listeners.add(force)
    return () => {
      listeners.delete(force)
    }
  }, [])
  return locale
}
export function t(key: string, ...args: unknown[]): string {
  return formatClientMessage(locale === 'en' ? (clientEnglish[key] ?? translate(locale, key)) : key, args)
}
/** Refresh language-derived data while retaining mounted form state. */
export function useLocaleDidShow(callback: () => void): void {
  const latest = useRef(callback)
  const visible = useRef(false)
  latest.current = callback
  useDidShow(() => {
    visible.current = true
    latest.current()
  })
  useDidHide(() => {
    visible.current = false
  })
  useEffect(() => {
    const refresh = () => {
      if (visible.current) latest.current()
    }
    listeners.add(refresh)
    return () => {
      listeners.delete(refresh)
    }
  }, [])
}
export function localizeBuiltinGame<T extends { name: string; gameKey?: string | null; key?: string }>(game: T): T {
  return localizeBuiltin(game, locale)
}
