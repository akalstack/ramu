import { ChevronRight, GitFork, MessageSquareShare } from 'lucide-react'
import type { MessageOrigin, StartedThread, ThreadReportOutcome } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MarkdownText } from '../../../chat/MarkdownText'
import { t, useLanguage } from '../../../i18n'
import { useWorkspace } from '../../../workspace/workspace'
import { CARET_CLASS, GHOST_TEXT_BUTTON_CLASS, TOOL_DISCLOSURE_PANEL_CLASS } from '../styles'
import { MessageTime } from './MessageTime'

/** The header chip on a thread an agent started: it opens the starting thread. */
export function ThreadOriginChip({ taskId }: { taskId: string | undefined }) {
  useLanguage()
  const ws = useWorkspace()
  const origin = ws.tasks.find((task) => task.id === taskId)?.startedFrom
  if (!origin) return null
  // A thread another host's agent started cannot be opened from here: it names that host and its thread there.
  if (origin.host)
    return (
      <span
        className="inline-flex max-w-[260px] items-center gap-1 text-caption text-muted-foreground"
        title={t('Started by an agent on {0}', { '0': origin.host })}
      >
        <GitFork size={13} aria-hidden="true" />
        <span className="min-w-0 truncate">
          {t('From {0} on {1}', { '0': origin.title ?? t('another thread'), '1': origin.host })}
        </span>
      </span>
    )
  if (!origin.taskId) return null
  const starter = origin.taskId
  const label = t('From {0}', { '0': origin.title ?? t('another thread') })
  return (
    <Button
      variant="ghost"
      size="sm"
      className={`${GHOST_TEXT_BUTTON_CLASS} max-w-[260px]`}
      title={t('Started by the agent in {0}', { '0': origin.title ?? '' })}
      onClick={() => ws.openTask(starter)}
    >
      <GitFork size={13} aria-hidden="true" />
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  )
}

/** The card in the starting thread listing the threads its agent started, each one a click away. */
export function ThreadsStartedCard({ threads }: { threads: StartedThread[] }) {
  useLanguage()
  const ws = useWorkspace()
  return (
    <div className="m-[12px_0] flex items-start gap-3 rounded-(--radius-m) bg-fill p-[15px]">
      <GitFork size={16} className="mt-0.5 flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-left">
        <strong>
          {threads.length === 1 ? t('Started a thread') : t('Started {0} threads', { '0': threads.length })}
        </strong>
        <ul className="mt-1 flex flex-col gap-1">
          {threads.map((thread, index) => (
            <li key={thread.taskId || index} className="flex min-w-0 items-center gap-2 text-caption">
              <span className="min-w-0 flex-1 truncate">
                {thread.title}
                <span className="text-muted-foreground">
                  {' · '}
                  {thread.projectName}
                  {thread.host ? ` · ${t('on {0}', { '0': thread.host })}` : ''}
                  {thread.pending ? ` · ${t('Waiting for {0}', { '0': thread.host ?? '' })}` : ''}
                </span>
                {thread.error && <span className="block text-bad">{thread.error}</span>}
              </span>
              {thread.taskId && !thread.host && ws.tasks.some((task) => task.id === thread.taskId) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className={GHOST_TEXT_BUTTON_CLASS}
                  onClick={() => ws.openTask(thread.taskId)}
                >
                  {t('Open')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

const REPORT_TITLES: Record<ThreadReportOutcome, string> = {
  completed: '{0} finished',
  'needs-input': '{0} is waiting for you',
  failed: '{0} failed',
  interrupted: '{0} was interrupted',
  cancelled: '{0} was stopped',
}

/**
 * A message another thread sent this one: its report when it finished, failed or needs you, or a note its agent wrote.
 * The agent here received the full message; the person reads who sent it and what it said, one click from that thread.
 */
export function ThreadMessageCard({ from, at }: { from: MessageOrigin; at?: number }) {
  useLanguage()
  const ws = useWorkspace()
  const report = from.kind === 'thread-report'
  const openable = !from.host && !!from.taskId && ws.tasks.some((task) => task.id === from.taskId)
  const title = report
    ? t(REPORT_TITLES[from.outcome], { '0': from.title })
    : t('Message from {0}', { '0': from.title })
  const Icon = report ? GitFork : MessageSquareShare
  return (
    <div
      className={`m-[12px_0] flex items-start gap-3 rounded-(--radius-m) bg-fill p-[12px_15px] ${report && from.outcome === 'failed' ? 'shadow-[inset_2px_0_0_var(--bad)]' : ''}`}
      role="note"
      aria-label={title}
    >
      <Icon size={16} className="mt-0.5 flex-none text-muted-foreground" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-left">
        <div className="flex min-w-0 items-center gap-2">
          <strong className="min-w-0 flex-1 truncate font-medium">{title}</strong>
          {from.host && (
            <span className="flex-none text-caption text-muted-foreground">{t('on {0}', { '0': from.host })}</span>
          )}
          <span className="flex-none text-caption text-muted-foreground">
            <MessageTime at={at} />
          </span>
          {openable && (
            <Button
              variant="ghost"
              size="sm"
              className={GHOST_TEXT_BUTTON_CLASS}
              onClick={() => ws.openTask(from.taskId!)}
            >
              {t('Open thread')}
            </Button>
          )}
        </div>
        {from.detail && (
          <Collapsible defaultOpen={!report}>
            <CollapsibleTrigger
              render={<Button variant="ghost" size="sm" />}
              className="group -ml-2 mt-0.5 h-6 gap-1 px-2 text-caption font-normal text-muted-foreground"
            >
              {report ? t('Report') : t('Message')}
              <ChevronRight size={12} className={`${CARET_CLASS} group-data-[panel-open]:rotate-90`} />
            </CollapsibleTrigger>
            <CollapsibleContent className={TOOL_DISCLOSURE_PANEL_CLASS}>
              <MarkdownText density="compact" className="msg assistant mt-1 max-h-[360px] overflow-y-auto">
                {from.detail}
              </MarkdownText>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  )
}
