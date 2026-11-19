/** "45s", "3m 12s" or "2h 5m". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

// Building an Intl formatter costs far more than using one, so each locale keeps its own.
const timeFormats = new Map<string, { time: Intl.DateTimeFormat; full: Intl.DateTimeFormat }>()
/** The cached time formats for a locale: clock time and the full date. */
export function timeFormat(locale: string) {
  let formats = timeFormats.get(locale)
  if (!formats)
    timeFormats.set(
      locale,
      (formats = {
        time: new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }),
        full: new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'medium' }),
      }),
    )
  return formats
}
