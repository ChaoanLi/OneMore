/** Taro's router.path may already contain an internal stamp query. Keep only the logical page and application parameters. */
export function makePageUrl(path: string, params: Record<string, string | undefined>): string {
  const query = Object.entries(params)
    .filter(([key, value]) => key !== 'stamp' && key !== '$taroTimestamp' && value !== undefined)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value!)}`)
    .join('&')
  return `${path.split('?')[0]}${query ? '?' + query : ''}`
}
