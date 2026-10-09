const CONVERSATION_PAUSE_MS = 30 * 60 * 1000

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function needsChatDate(at: number | undefined, previousAt: number | undefined): boolean {
  if (at === undefined || !Number.isFinite(at)) return false
  if (previousAt === undefined || !Number.isFinite(previousAt)) return true
  return !sameDay(new Date(at), new Date(previousAt)) || at - previousAt >= CONVERSATION_PAUSE_MS
}

export function formatChatDate(at: number, now = Date.now()): string {
  const date = new Date(at), today = new Date(now), yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const day = sameDay(date, today) ? 'Today' : sameDay(date, yesterday) ? 'Yesterday' : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
  return `${day} ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}`
}
