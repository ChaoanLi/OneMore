import { localizeBuiltinGame } from '@couju/core'
export type Locale = 'zh-CN' | 'en'
export function chooseLocale(input: { account?: unknown; local?: unknown; device?: string }): Locale {
  if (input.account === 'zh-CN' || input.account === 'en') return input.account
  if (input.local === 'zh-CN' || input.local === 'en') return input.local
  return input.device?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
export function formatClientMessage(template: string, args: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)] ?? ''))
}
/** Share catalog identities with server views, drafts, notifications and calendar output. */
export const localizeBuiltin = localizeBuiltinGame
