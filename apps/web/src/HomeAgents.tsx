import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { Square } from 'lucide-react'
import { invoke, ramu } from './ipc'
import { t, useLanguage } from './i18n'
import { useWorkspace } from './workspace/workspace'
import { ipcQueryKey } from './dataQueries'
import { useAgentStream } from './views/agent/hooks/useAgentStream'
import { outcomesOf, questionStatesOf } from './views/agent/lib/derive'
import { QuestionDock } from './chat/QuestionCard'
import { PermissionRequestCard } from './views/agent/components/PermissionRequestCard'
import { ElicitationCard } from './chat/ElicitationCard'
import { notifyError } from './chat/Notifications'
import { errorText } from './lib/errors'
import { ProviderWaitIcon } from './models/ProviderWait'
import { timeAgo } from './Menu'

function PendingInput({ sessionId }: { sessionId: string }) {
  const { events } = useAgentStream(sessionId)
  const outcomes = useMemo(() => outcomesOf(events), [events])
  const states = useMemo(() => questionStatesOf(events), [events])
  const [open, setOpen] = useState(true)
  const questions = events.filter(
    (event): event is Extract<typeof event, { kind: 'question' }> =>
      event.kind === 'question' && !outcomes.has(event.requestId),
  )
  return (
    <div className="flex flex-col gap-2">
      {events
        .filter(
          (event): event is Extract<typeof event, { kind: 'permission-request' }> =>
            event.kind === 'permission-request' && !outcomes.has(event.requestId),
        )
        .map((event) => (
          <PermissionRequestCard
            key={event.requestId}
            event={event}
            sessionId={sessionId}
            pending
            outcome={undefined}
          />
        ))}
      <QuestionDock
        sessionId={sessionId}
        requests={questions}
        states={states}
        open={open}
        onOpenChange={setOpen}
        focus={null}
      />
      {events
        .filter(
          (event): event is Extract<typeof event, { kind: 'elicitation' }> =>
            event.kind === 'elicitation' && !outcomes.has(event.requestId),
        )
        .map((event) => (
          <ElicitationCard
            key={event.requestId}
            sessionId={sessionId}
            request={event}
            pending
            status={states.get(event.requestId) ?? { answers: {}, drafts: {}, waiting: true }}
          />
        ))}
    </div>
  )
}

export type AgentGroup = 'Waiting for your input' | 'Running' | 'Waiting for allowance' | 'Done'

const groupOf = (session: AgentSessionInfo): AgentGroup =>
  session.state === 'needs-input' || session.pendingInput
    ? 'Waiting for your input'
    : session.waitingUntil
      ? 'Waiting for allowance'
      : ['running', 'starting'].includes(session.state)
        ? 'Running'
        : 'Done'

/** Every live thread and helper (archived threads excluded), grouped by what it needs from you. Shared by Home and Inbox. */
export function useAgentOverview() {
  const ws = useWorkspace()
  const sessions = useQuery({
    queryKey: ipcQueryKey('agent.all'),
    queryFn: () => ramu.invoke('agent.all'),
    refetchInterval: 5000,
  })
  const { refetch } = sessions
  useEffect(
    () =>
      ramu.on('workspace:changed', () => {
        void refetch()
      }),
    [refetch],
  )
  const groups = useMemo(() => {
    const out: Record<AgentGroup, AgentSessionInfo[]> = {
      'Waiting for your input': [],
      Running: [],
      'Waiting for allowance': [],
      Done: [],
    }
    const lastActive = (session: AgentSessionInfo) =>
      ws.tasks.find((task) => task.id === session.taskId)?.lastActiveAt ?? 0
    for (const session of sessions.data ?? [])
      if (ws.tasks.some((task) => task.id === session.taskId && task.status !== 'archived'))
        out[groupOf(session)].push(session)
    for (const list of Object.values(out)) list.sort((a, b) => lastActive(b) - lastActive(a))
    return out
  }, [sessions.data, ws.tasks])
  return { groups, error: sessions.error, refetch }
}

const STATE =
  "inline-flex size-3.5 flex-none items-center justify-center [&.spinner::before]:[content:''] [&.spinner::before]:size-3 [&.spinner::before]:rounded-full [&.spinner::before]:[border:2px_solid_var(--line-strong)] [&.spinner::before]:[border-top-color:var(--soft)]! [&.spinner::before]:[animation:spin_0.9s_linear_infinite] [&.dot::before]:[content:''] [&.dot::before]:size-2 [&.dot::before]:rounded-full [&.dot::before]:[background:var(--muted)] [&.warn::before]:[background:var(--warn)] [&.bad::before]:[background:var(--bad)]"

function AgentState({ session, group }: { session: AgentSessionInfo; group: AgentGroup }) {
  if (group === 'Waiting for allowance' && session.waitingUntil)
    return <ProviderWaitIcon retryAt={session.waitingUntil} />
  const [kind, label] =
    group === 'Waiting for your input'
      ? ['dot warn', t('Waiting for your input')]
      : group === 'Running'
        ? ['spinner', t('Agent working')]
        : session.state === 'failed'
          ? ['dot bad', t('Agent failed')]
          : ['dot', t('Done')]
  return <span className={`${STATE} ${kind}`} role="img" aria-label={label} title={label} />
}

/**
 * One agent as a list row: state, title (opens it), where it runs, age, and Stop while it works. A row waiting on you
 * shows its question, approval or form under it so it can be answered in place.
 */
export function AgentRow({ session, group }: { session: AgentSessionInfo; group: AgentGroup }) {
  useLanguage()
  const ws = useWorkspace()
  const task = ws.tasks.find((task) => task.id === session.taskId)
  const project = ws.projects.find((project) => project.id === task?.projectId)
  const reviews = useQuery({
    queryKey: ipcQueryKey('reviews.list'),
    queryFn: () => ramu.invoke('reviews.list'),
    refetchInterval: 10000,
  })
  const changed = new Set(
    (reviews.data ?? [])
      .filter((review) => review.sessionId === (session.nativeTask ? session.parentId : session.id))
      .flatMap((review) => review.files.map((file) => `${file.repoId}:${file.path}`)),
  ).size
  const open = () => {
    const parentId = session.nativeTask ? session.parentId! : session.id
    if (session.nativeTask)
      sessionStorage.setItem('ramu.open-helper', JSON.stringify({ parentId, agentId: session.nativeTask.agentId }))
    ws.openTask(session.taskId)
    ws.openView(session.taskId, { kind: 'agent', sessionId: parentId })
    if (session.nativeTask) requestAnimationFrame(() => window.dispatchEvent(new Event('ramu:open-helper')))
  }
  const stop = () =>
    void (
      session.nativeTask
        ? invoke('agent.stopTask', session.parentId!, session.nativeTask.agentId)
        : invoke('agent.stop', session.id)
    ).catch((e) => notifyError(errorText(e)))
  const meta = [
    project?.name ?? t('No project'),
    session.settings.model || session.provider,
    changed ? t(session.nativeTask ? '{0} parent-thread changed files' : '{0} changed files', { 0: changed }) : null,
  ].filter(Boolean)
  return (
    <article className="agent-row group/row [&+&]:border-t [&+&]:border-(--line)">
      <div className="flex min-h-11 items-center gap-2.5 px-3">
        <AgentState session={session} group={group} />
        <Button
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start! gap-2 bg-transparent! p-0 text-left font-normal text-foreground hover:underline"
          onClick={open}
        >
          <span className="truncate">{session.parentId ? session.title || t('Helper') : (task?.title ?? '')}</span>
        </Button>
        {session.parentId && <Badge variant="secondary">{t('Helper')}</Badge>}
        <span className="hidden min-w-0 shrink truncate text-caption text-muted-foreground @[520px]:inline">
          {meta.join(' · ')}
        </span>
        <span className="w-7 flex-none text-right text-caption text-muted-foreground tabular-nums">
          {task ? timeAgo(task.lastActiveAt) : ''}
        </span>
        {group !== 'Done' && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100"
            aria-label={t('Stop')}
            title={t('Stop')}
            disabled={!!session.nativeTask && !session.nativeTask.canStop}
            onClick={stop}
          >
            <Square size={11} />
          </Button>
        )}
      </div>
      {session.parentId && (
        <Button
          variant="link"
          size="sm"
          className="mb-1 ml-9 h-auto p-0 text-caption"
          onClick={() => {
            void invoke('agent.get', session.parentId!)
              .then((parent) => {
                ws.openTask(parent.taskId)
                ws.openView(parent.taskId, { kind: 'agent', sessionId: parent.id })
              })
              .catch((e) => notifyError(errorText(e)))
          }}
        >
          {t('Open parent thread')}
        </Button>
      )}
      {group === 'Waiting for your input' && (
        <div className="px-3 pb-3">
          <PendingInput sessionId={session.id} />
        </div>
      )}
    </article>
  )
}

/** Agent rows in one surface, separated by hairlines. */
export function AgentList({ items }: { items: { session: AgentSessionInfo; group: AgentGroup }[] }) {
  return (
    <div className="@container overflow-hidden rounded-(--radius-m) bg-card">
      {items.map(({ session, group }) => (
        <AgentRow key={session.id} session={session} group={group} />
      ))}
    </div>
  )
}

/** The rows of the given groups, in that order. */
export const rowsOf = (groups: Record<AgentGroup, AgentSessionInfo[]>, ...names: AgentGroup[]) =>
  names.flatMap((group) => groups[group].map((session) => ({ session, group })))

export function HelperBreadcrumb({ parentId }: { parentId: string }) {
  const ws = useWorkspace()
  return (
    <div className="px-3 pt-2">
      <Button
        variant="link"
        size="sm"
        onClick={() => {
          void invoke('agent.get', parentId)
            .then((parent) => {
              ws.openTask(parent.taskId)
              ws.openView(parent.taskId, { kind: 'agent', sessionId: parent.id })
            })
            .catch((error) => notifyError(errorText(error)))
        }}
      >
        {t('Back to parent thread')}
      </Button>
    </div>
  )
}
