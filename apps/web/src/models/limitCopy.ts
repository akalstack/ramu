import type { LimitTrayView } from '@ramu/shared/chat/providerWait'
import { formatLocale, t } from '../i18n'

/** The time of day, with the date when it is not today. */
export function resumeTime(retryAt: number): string {
  const date = new Date(retryAt),
    sameDay = date.toDateString() === new Date().toDateString()
  return date.toLocaleString(
    formatLocale(),
    sameDay
      ? { hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
  )
}

/** The words of one tray row: a bold title and a muted detail. */
export function limitTrayCopy(
  view: LimitTrayView,
  source: 'thread' | 'default',
  stillLimited: boolean,
): { title: string; detail: string } {
  const time = view.resetAt ? resumeTime(view.resetAt) : ''
  const off = source === 'thread'
  let detail: string
  switch (view.case) {
    case 'auto-known':
      detail = t('resumes automatically around {0}', { '0': time })
      break
    case 'auto-unknown':
      detail = t('resuming automatically, checking every few minutes')
      break
    case 'off-known':
      detail = off
        ? t('resets around {0} · auto-resume is off for this thread', { '0': time })
        : t('resets around {0} · auto-resume is off in Settings', { '0': time })
      break
    case 'off-unknown':
      detail = off
        ? t('reset time unknown · auto-resume is off for this thread')
        : t('reset time unknown · auto-resume is off in Settings')
      break
    case 'reset-off':
      detail = t('nothing ran on its own')
      break
  }
  if (view.case === 'reset-off') return { title: t('Limit has reset'), detail }
  if (!stillLimited) return { title: t('Limit reached'), detail }
  return {
    title: t('Still limited'),
    detail: view.resetAt ? t('resets around {0}', { '0': time }) : detail,
  }
}

/** Composer placeholder while the thread is at a usage limit: where a message goes and when it is sent. */
export function limitPlaceholder(view: LimitTrayView, autoResume: boolean): string {
  if (!autoResume) return t('Message · queued until you resume')
  return view.resetAt
    ? t('Message · sends when the limit resets (around {0})', { 0: resumeTime(view.resetAt) })
    : t('Message · sends when the limit clears')
}

/**
 * The composer's play button at a usage limit. It is "Try again" only when the tray makes that the main button
 * (reset unknown, guessed or passed); with a known reset in the future the tray keeps the quiet "Try anyway".
 */
export function limitResume(view: LimitTrayView | null): { active: boolean; label?: string; title?: string } {
  if (!view?.primary) return { active: false }
  return view.action === 'resume'
    ? { active: true, label: 'Resume', title: 'Resume now that the limit has reset' }
    : { active: true, label: 'Try again', title: 'Try again now' }
}
