import { ChevronDown, Clock3, RefreshCw, WifiOff } from 'lucide-react'
import { limitTrayView, type ProviderWaitState } from '@ramu/shared/chat/providerWait'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../i18n'
import { limitTrayCopy, resumeTime } from './limitCopy'
import { Menu } from '../Menu'
import type { LimitRetry } from './useLimitRetry'
import { autoResumeLabel, autoResumeSection, type AutoResumeControl } from './autoResumeMenu'
import { useRestartingHosts } from '../workspace/restartingHosts'

/** Status-slot icon for chat lists: the chat is at a usage limit and continues on its own once it resets. */
export function ProviderWaitIcon({ retryAt }: { retryAt: number }) {
  useLanguage()
  const label = t('Limit reached · resumes around {0}', { '0': resumeTime(retryAt) })
  return (
    <span
      className="task-state provider-wait-state flex-none inline-flex items-center justify-center w-3 h-3"
      title={label}
      aria-label={label}
      role="img"
    >
      <Clock3 size={12} className="text-warn" aria-hidden="true" />
    </span>
  )
}

const ACTION_LABEL = { 'try-again': 'Try again', 'try-anyway': 'Try anyway', resume: 'Resume' } as const

/** One line of the chat tray for a thread at a usage limit. Presentational: the container supplies the actions. */
export function LimitTrayRow({
  wait,
  autoResume,
  now = Date.now(),
  stillLimited = false,
  busy = false,
  onTry,
  readOnly = false,
}: {
  readOnly?: boolean
  wait: ProviderWaitState
  autoResume: AutoResumeControl
  now?: number
  stillLimited?: boolean
  busy?: boolean
  onTry: () => void
}) {
  useLanguage()
  const view = limitTrayView(wait, autoResume.effective.value, now)
  const { title, detail } = limitTrayCopy(view, autoResume.effective.source, stillLimited)
  const tooltip = [
    `${title} · ${detail}`,
    wait.reason,
    t('You can keep writing. Messages you send now are queued and the wait continues. Stop clears the wait.'),
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <div
      role="status"
      title={tooltip}
      className="provider-wait flex flex-wrap items-center gap-2 min-h-7 px-1 text-caption"
    >
      <Clock3 size={14} className="flex-none text-muted-foreground" aria-hidden="true" />
      <strong className={`flex-none font-medium ${view.case === 'reset-off' ? 'text-foreground' : 'text-warn'}`}>
        {title}
      </strong>
      {/* The detail is the when and the how; it wraps rather than truncating, and the actions drop below it only on a narrow pane. */}
      <span className="min-w-48 flex-1 break-words text-muted-foreground">{detail}</span>
      <Button
        variant={view.primary ? 'default' : 'ghost'}
        size="xs"
        // The bar is caption-sized; the app button would otherwise draw body text at full control height.
        className={`h-6 min-h-6 flex-none px-2 py-0 text-caption ${view.primary ? '' : 'text-muted-foreground'}`}
        disabled={busy || readOnly}
        onClick={onTry}
      >
        {t(ACTION_LABEL[view.action])}
      </Button>
      <Menu
        disabled={readOnly}
        label={autoResumeLabel(autoResume)}
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover flex-none h-6 gap-1 px-1.5 text-caption font-normal"
        align="end"
        icon={
          <>
            <span>{autoResumeLabel(autoResume)}</span>
            <ChevronDown size={12} aria-hidden="true" />
          </>
        }
        items={autoResumeSection(autoResume)}
      />
    </div>
  )
}

/**
 * Shown in the chat tray while the thread is at a usage limit. The thread is not failed: messages are kept and sent
 * when it continues. Try again checks the limit now; Auto-resume is this thread's own choice or the default.
 */
export function ProviderWaitNote({
  retry,
  autoResume,
  readOnly = false,
}: {
  retry: LimitRetry
  autoResume: AutoResumeControl
  readOnly?: boolean
}) {
  if (!retry.wait) return null
  return (
    <LimitTrayRow
      wait={retry.wait}
      readOnly={readOnly}
      autoResume={autoResume}
      stillLimited={retry.stillLimited}
      busy={retry.busy}
      onTry={retry.tryNow}
    />
  )
}

/** Shown in the chat tray while this window's computer is unreachable. Like a usage limit, messages are kept and sent once it is back. */
export function HostWaitNote({ name, hostId }: { name: string; hostId: string }) {
  useLanguage()
  // A restart someone asked for is brief and expected; it is not the host going away.
  const restarting = useRestartingHosts().has(hostId)
  const detail = t(
    '{0} is not reachable. Keep writing: messages wait on this device and send in order when it reconnects. They never interrupt a running turn.',
    { '0': name },
  )
  const Icon = restarting ? RefreshCw : WifiOff
  return (
    <div role="status" title={detail} className="provider-wait flex items-center gap-2 min-h-7 px-1 text-caption">
      <Icon size={14} className="flex-none text-muted-foreground" aria-hidden="true" />
      <strong className="flex-none font-medium text-foreground">
        {restarting ? t('{0} is restarting', { '0': name }) : t('Waiting for {0}', { '0': name })}
      </strong>
      <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">
        {t('Messages send when it reconnects')}
      </span>
    </div>
  )
}
