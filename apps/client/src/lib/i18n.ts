import Taro, { useDidHide, useDidShow } from '@tarojs/taro'
import { useEffect, useReducer, useRef } from 'react'
import { translate } from '@couju/core'
import { clientEnglish } from './locales/en'
import { chooseLocale, formatClientMessage, localizeBuiltin, type Locale } from './localePreference'
import { requestContext } from './requestContext'
import { afterCommands } from './commands'

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
let selectionRevision = 0
let selectedLocale = locale
export function getLocaleSelection(): { revision: number; locale: Locale } {
  return { revision: selectionRevision, locale: selectedLocale }
}
export async function setLocale(next: Locale): Promise<void> {
  selectedLocale = next
  const revision = ++selectionRevision
  const context = requestContext.capture()
  Taro.setStorageSync(STORAGE_KEY, next)
  let applied = false
  await afterCommands(() => {
    if (revision !== selectionRevision || !requestContext.sameContent(context)) return
    applyLocale(next)
    applied = true
  })
  // Persistence starts after draining commands, so its own PATCH cannot deadlock the gate.
  if (applied && revision === selectionRevision && requestContext.sameIdentity(context)) await persist?.(next)
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
