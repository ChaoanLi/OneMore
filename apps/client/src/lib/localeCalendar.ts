/** Calendar selections use the viewer's local YYYY-MM-DD, never a translated label. */
export function isWeekendLocalDate(localDate: string): boolean {
  const weekday = new Date(`${localDate}T12:00:00Z`).getUTCDay()
  return weekday === 0 || weekday === 6
}
