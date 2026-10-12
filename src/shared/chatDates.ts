import { translate, type Language } from './i18n'
const CONVERSATION_PAUSE_MS = 30 * 60 * 1000

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function needsChatDate(at: number | undefined, previousAt: number | undefined): boolean {
  if (at === undefined || !Number.isFinite(at)) return false
  if (previousAt === undefined || !Number.isFinite(previousAt)) return true
  return !sameDay(new Date(at), new Date(previousAt)) || at - previousAt >= CONVERSATION_PAUSE_MS
}

export function formatChatDate(at: number, now = Date.now(), language: Language = 'en'): string {
  const locale = language === 'id' ? 'id-ID' : 'en-US'
  const date = new Date(at), today = new Date(now), yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const day = sameDay(date, today) ? translate(language, 'Today') : sameDay(date, yesterday) ? translate(language, 'Yesterday') : date.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) })
  return `${day} ${date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit', hour12: language === 'en' })}`
}
