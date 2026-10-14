import { Clock3 } from 'lucide-react'
import { formatLocale, t, useLanguage } from './i18n'

/** The time of day, with the date when it is not today. */
export function resumeTime(retryAt: number): string {
  const date = new Date(retryAt), sameDay = date.toDateString() === new Date().toDateString()
  return date.toLocaleString(formatLocale(), sameDay ? { hour: 'numeric', minute: '2-digit' } : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Status-slot icon for chat lists: the chat is idle but will continue on its own after a usage limit resets. */
export function ProviderWaitIcon({ retryAt }: { retryAt: number }) {
  useLanguage()
  const label = t('Waiting for usage limit · resumes around {0}', { '0': resumeTime(retryAt) })
  return <span className="task-state provider-wait-state flex-none inline-flex items-center justify-center w-3 h-3" title={label} aria-label={label} role="img"><Clock3 size={12} className="text-muted-foreground" aria-hidden="true" /></span>
}

/** Shown in the chat tray while every provider is at its usage limit. The chat is not failed: messages are kept and sent after the reset. */
export function ProviderWaitNote({ retryAt }: { retryAt: number }) {
  useLanguage()
  const time = resumeTime(retryAt)
  const detail = t('Every provider you can fall back to has reached its limit. You can keep writing: messages are kept and sent, and unfinished work continues, once one is available. Next check around {0}.', { '0': time })
  return <div role="status" title={detail} className="provider-wait flex items-center gap-2 min-h-7 px-1 text-caption">
    <Clock3 size={14} className="flex-none text-muted-foreground" aria-hidden="true" />
    <strong className="flex-none font-medium text-foreground">{t('Waiting for a usage limit to reset')}</strong>
    <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">{t('Resumes around {0}', { '0': time })}</span>
  </div>
}
