import { translate, type Locale } from './i18n'
import type { GameTemplate, MyGame, RoleRequirement } from './types'

export const GM_ROLE: RoleRequirement = { key: 'gm', label: 'KP/GM', min: 1 }

/** 内置游戏目录。人数是默认值，发起人可以在活动里修改。 */
export const GAME_CATALOG: readonly GameTemplate[] = [
  {
    key: 'dota2',
    name: 'Dota 2',
    emoji: '⚔️',
    minPlayers: 5,
    maxPlayers: 5,
    roles: [],
    defaultDurationMin: 120,
    hint: '五黑；想打内战可把上限改成 10',
  },
  {
    key: 'riichi',
    name: '日麻',
    emoji: '🀄',
    minPlayers: 4,
    maxPlayers: 4,
    roles: [],
    defaultDurationMin: 120,
    hint: '四人麻将；三麻可把人数改成 3',
  },
  {
    key: 'boardgame',
    name: '桌游',
    emoji: '🎲',
    minPlayers: 3,
    maxPlayers: 6,
    roles: [],
    defaultDurationMin: 150,
  },
  {
    key: 'trpg',
    name: 'TRPG 跑团',
    emoji: '🐙',
    minPlayers: 3,
    maxPlayers: 6,
    roles: [GM_ROLE],
    defaultDurationMin: 240,
    hint: '需要一位 KP/GM（人数包含 KP）',
  },
  {
    key: 'werewolf',
    name: '狼人杀',
    emoji: '🐺',
    minPlayers: 8,
    maxPlayers: 12,
    roles: [],
    defaultDurationMin: 120,
  },
]

export function findGame(key: string | null | undefined): GameTemplate | undefined {
  if (!key) return undefined
  return GAME_CATALOG.find((g) => g.key === key)
}

export const CUSTOM_GAME_EMOJI = '✨'

/** 自定义游戏可选的图标 */
export const GAME_EMOJIS = ['🎮', '🃏', '♟️', '🎯', '🏀', '🏸', '🎤', '🎬', '🍲', '🧩', '🕵️', '🚗', '⛰️', '🎲', '🀄', '⚔️', '🐙', '🐺', '✨', '☕']

/** 把内置游戏转成“我的游戏”条目 */
export function myGameFromCatalog(g: GameTemplate): MyGame {
  return { id: g.key, gameKey: g.key, name: g.name, emoji: g.emoji, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers, needsGm: g.roles.some((r) => r.key === 'gm') }
}

/** 用户的游戏列表；还没设置时用内置目录 */
export function resolveMyGames(myGames: MyGame[] | undefined): MyGame[] {
  return myGames && myGames.length > 0 ? myGames : GAME_CATALOG.map(myGameFromCatalog)
}

/** Catalog labels may change language; explicitly renamed games remain user-authored content. */
export function localizeBuiltinGame<T extends { name: string; gameKey?: string | null; key?: string; hint?: string }>(game: T, locale: Locale = 'zh-CN'): T {
  const builtin = findGame(game.gameKey ?? game.key)
  if (!builtin) return game
  const defaultNames = [builtin.name, translate('en', builtin.name)]
  const name = defaultNames.includes(game.name) ? translate(locale, builtin.name) : game.name
  const hint = game.hint === builtin.hint || game.hint === translate('en', builtin.hint ?? '') ? builtin.hint && translate(locale, builtin.hint) : game.hint
  return { ...game, name, ...(game.hint !== undefined ? { hint } : {}) }
}
