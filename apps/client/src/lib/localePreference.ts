export type Locale = 'zh-CN' | 'en'
export function chooseLocale(input: { account?: unknown; local?: unknown; device?: string }): Locale {
  if (input.account === 'zh-CN' || input.account === 'en') return input.account
  if (input.local === 'zh-CN' || input.local === 'en') return input.local
  return input.device?.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}
export function formatClientMessage(template: string, args: readonly unknown[]): string {
  return template.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)] ?? ''))
}
const builtins: Record<string, { zh: string; en: string }> = {
  dota2: { zh: 'Dota 2', en: 'Dota 2' },
  riichi: { zh: '日麻', en: 'Riichi Mahjong' },
  boardgame: { zh: '桌游', en: 'Board games' },
  trpg: { zh: 'TRPG 跑团', en: 'Tabletop RPG' },
  werewolf: { zh: '狼人杀', en: 'Werewolf' },
}
export function localizeBuiltin<T extends { name: string; gameKey?: string | null; key?: string }>(game: T, locale: Locale): T {
  const known = builtins[game.gameKey ?? game.key ?? '']
  if (!known || ![known.zh, known.en].includes(game.name)) return game
  return { ...game, name: locale === 'en' ? known.en : known.zh }
}
