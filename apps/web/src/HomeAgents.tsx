import { animateThreadListChange } from './workspace/threadListMotion'
import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DateTime } from 'luxon'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { ThreadHoverCard } from './sidebar/projects/ThreadHoverCard'
import { Check, RotateCcw, Square } from 'lucide-react'
import { FadeText } from './FadeText'
import { StateDot } from './sidebar/projects/TaskStateIcon'
import { ICON_BUTTON_CLASS } from './sidebar/projects/constants'
import { ramu } from './ipc'
import { ownHostId } from './hosts'
import { useHost } from './workspace/HostProvider'
import { t, useLanguage } from './i18n'
import { useHostRuntime, useWorkspace } from './workspace/workspace'
import { ipcQueryKeyOn } from './dataQueries'
import { useAgentStream } from './views/agent/hooks/useAgentStream'
import { outcomesOf, questionStatesOf } from './views/agent/lib/derive'
import { QuestionDock } from './chat/QuestionCard'
import { PermissionRequestCard } from './views/agent/components/PermissionRequestCard'
import { ElicitationCard } from './chat/ElicitationCard'
import { notifyError } from './chat/Notifications'
import { errorText } from './lib/errors'
import { ProviderWaitIcon } from './models/ProviderWait'
import { timeAgo } from './Menu'
import { goalActive, groupOf, type AgentGroup } from './agentGroups'

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

/** Every live thread and helper (archived threads excluded), grouped by what it needs from you. Shared by Home and Inbox. */
export function useAgentOverview() {
  const ws = useWorkspace()
  const host = useHost()
  const { on } = useHostRuntime()
  const sessions = useQuery({
    queryKey: ipcQueryKeyOn(host.id, 'agent.all'),
    // Straight to the bridge: `invoke` would read through this same query key.
    queryFn: () => (host.id === ownHostId() ? ramu.invoke('agent.all') : ramu.invokeOn(host.id, 'agent.all')),
    refetchInterval: 5000,
  })
  const { refetch } = sessions
  useEffect(
    () =>
      on('workspace:changed', () => {
        void refetch()
      }),
    [refetch, on],
  )
  const groups = useMemo(() => {
    const out: Record<AgentGroup, AgentSessionInfo[]> = {
      'Waiting for your input': [],
      Running: [],
      'Limit reached': [],
      Done: [],
    }
    const lastActive = (session: AgentSessionInfo) =>
      ws.tasks.find((task) => task.id === session.taskId)?.lastActiveAt ?? 0
    for (const session of sessions.data ?? []) {
      const task = ws.tasks.find((entry) => entry.id === session.taskId)
      if (task && task.status !== 'archived') out[groupOf(session, task)].push(session)
    }
    for (const list of Object.values(out)) list.sort((a, b) => lastActive(b) - lastActive(a))
    return out
  }, [sessions.data, ws.tasks])
  return { groups, error: sessions.error, refetch }
}

/** The trailing state, as on sidebar thread rows: working, needs you, usage wait or failed; finished rows show their age. */
function AgentState({
  session,
  group,
  at,
  unread,
  goal,
}: {
  session: AgentSessionInfo
  group: AgentGroup
  at?: number
  unread?: boolean
  /** The thread's goal is what keeps it running. */
  goal?: boolean
}) {
  if (group === 'Limit reached' && session.waitingUntil) return <ProviderWaitIcon retryAt={session.waitingUntil} />
  if (group === 'Waiting for your input')
    return <StateDot kind="dot warn text-warn" label={t('Waiting for your input')} />
  if (group === 'Running') return <StateDot kind="spinner" label={t(goal ? 'Working toward goal' : 'Agent working')} />
  if (session.state === 'failed') return <StateDot kind="dot bad" label={t('Agent failed')} />
  return (
    <>
      {unread && <StateDot kind="dot unread" label={t('Finished, not viewed yet')} />}
      <span className="agent-time min-w-6 flex-none text-right text-caption text-muted-foreground tabular-nums">
        {at ? timeAgo(at) : ''}
      </span>
    </>
  )
}

function openAgent(ws: ReturnType<typeof useWorkspace>, session: AgentSessionInfo) {
  const parentId = session.nativeTask ? session.parentId! : session.id
  if (session.nativeTask)
    sessionStorage.setItem('ramu.open-helper', JSON.stringify({ parentId, agentId: session.nativeTask.agentId }))
  ws.openTask(session.taskId)
  ws.openView(session.taskId, { kind: 'agent', sessionId: parentId })
  if (session.nativeTask) requestAnimationFrame(() => window.dispatchEvent(new Event('ramu:open-helper')))
}

/**
 * One agent, drawn like a sidebar thread row: title, project, a Sub-agent tag, and the state or age at the end,
 * which gives way to Stop on hover. Helpers listed under their thread are indented. A row waiting on you shows its
 * question, approval or form under it so it can be answered in place.
 */
export function AgentRow({
  session,
  group,
  helpers = 0,
}: {
  session: AgentSessionInfo
  group: AgentGroup
  /** How many sub-agents this thread started; shown as a count, the sub-agents themselves live in the thread. */
  helpers?: number
}) {
  useLanguage()
  const ws = useWorkspace()
  const { invoke, status: hostStatus } = useHost()
  const task = ws.tasks.find((task) => task.id === session.taskId)
  const project = ws.projects.find((project) => project.id === task?.projectId)
  const stop = () =>
    void (
      session.nativeTask
        ? invoke('agent.stopTask', session.parentId!, session.nativeTask.agentId)
        : invoke('agent.stop', session.id)
    ).catch((e) => notifyError(errorText(e)))
  const helper = !!session.parentId
  const title = helper ? session.title || t('Sub-agent') : (task?.title ?? '')
  // A sub-agent (listed only while it needs you) says which thread it belongs to.
  const prefix = helper ? task?.title : (project?.name ?? t('No project'))
  const open = () => openAgent(ws, session)
  return (
    <article className="agent-row" data-thread-motion-row="">
      <HoverCard open={helper || !task ? false : undefined}>
        <HoverCardTrigger
          render={<div />}
          delay={400}
          closeDelay={120}
          role="button"
          tabIndex={0}
          aria-label={title}
          onClick={open}
          onKeyDown={(e) => {
            if (e.target === e.currentTarget && e.key === 'Enter') open()
          }}
          className={`[&:hover_.row-actions]:flex [&:focus-within_.row-actions]:flex [&:hover_.agent-time]:hidden [&:focus-within_.agent-time]:hidden flex min-h-9 cursor-default items-center gap-2 rounded-(--radius-s) px-2.5 text-body leading-5 text-soft [transition:background_0.1s_var(--ease),_color_0.1s_var(--ease)] hover:bg-accent hover:text-foreground`}
        >
          <FadeText className="min-w-0 flex-1 overflow-hidden text-left whitespace-nowrap" text={title} />
          {helper && (
            <span className="flex-none rounded-full bg-fill px-1.5 text-caption text-muted-foreground">
              {t('Sub-agent')}
            </span>
          )}
          {prefix && (
            <span className="max-w-[25%] min-w-0 truncate text-caption text-muted-foreground" title={prefix}>
              {prefix}
            </span>
          )}
          <span className="hidden max-w-[40%] min-w-0 flex-none truncate text-caption text-muted-foreground @[480px]:inline">
            {[
              helpers > 0 && t(helpers === 1 ? '1 sub-agent' : '{0} sub-agents', { 0: helpers }),
              session.settings.model || session.provider,
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <AgentState
            session={session}
            group={group}
            at={task?.lastActiveAt}
            unread={ws.unread.has(session.taskId)}
            goal={goalActive(session, task)}
          />
          {group === 'Done' && !helper && (
            <span className="row-actions hidden flex-none items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                aria-label={task?.doneAt ? t('Reopen thread') : t('Mark thread done')}
                title={task?.doneAt ? t('Reopen') : t('Mark done')}
                onClick={(e) => {
                  e.stopPropagation()
                  void animateThreadListChange(async () => {
                    await invoke('tasks.done', session.taskId, !task?.doneAt)
                    await ws.refresh()
                  }).catch((error) => notifyError(errorText(error)))
                }}
              >
                {task?.doneAt ? <RotateCcw size={14} /> : <Check size={14} />}
              </Button>
            </span>
          )}
          {group !== 'Done' && (
            <span className="row-actions hidden flex-none items-center gap-0.5">
              <Button
                variant="ghost"
                size="icon-xs"
                className={ICON_BUTTON_CLASS}
                aria-label={t('Stop')}
                title={t('Stop')}
                disabled={!!session.nativeTask && !session.nativeTask.canStop}
                onClick={(e) => {
                  e.stopPropagation()
                  stop()
                }}
              >
                <Square size={11} />
              </Button>
            </span>
          )}
        </HoverCardTrigger>
        {task && !helper && (
          <ThreadHoverCard
            task={task}
            status={threadStatus(task, ws.unread.has(task.id), task.goalState)}
            workspaceName={
              task.workspaceId ? ws.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name : undefined
            }
            sharedWorkspace={
              !!task.workspaceId &&
              ws.tasks.some((other) => other.id !== task.id && other.workspaceId === task.workspaceId)
            }
            offline={hostStatus !== 'connected'}
          />
        )}
      </HoverCard>
      {group === 'Waiting for your input' && (
        <div className="px-2.5 pt-1 pb-3">
          <PendingInput sessionId={session.id} />
        </div>
      )}
    </article>
  )
}

type Item = { session: AgentSessionInfo; group: AgentGroup }

/**
 * Agent rows as a list, like the sidebar's. Only threads get rows; each shows how many sub-agents it started. A
 * sub-agent gets its own row only while it waits for your input, so it can be answered here.
 */
export function AgentList({ items }: { items: Item[] }) {
  const { groups } = useAgentOverview()
  const helpers = new Map<string, number>()
  for (const session of Object.values(groups).flat())
    if (session.parentId) helpers.set(session.parentId, (helpers.get(session.parentId) ?? 0) + 1)
  return (
    <div className="@container -mx-2.5 flex flex-col gap-px">
      {items.map((item) => (
        <AgentRow
          key={item.session.id}
          session={item.session}
          group={item.group}
          helpers={helpers.get(item.session.id) ?? 0}
        />
      ))}
    </div>
  )
}

/** Completed is recent history, not a to-do list: threads finished in the last week, newest first, at most 50. */
export const COMPLETED_DAYS = 7
export function recentlyCompleted(
  groups: Record<AgentGroup, AgentSessionInfo[]>,
  tasks: { id: string; lastActiveAt: number; doneAt?: number | null }[],
) {
  const since = DateTime.now()
    .startOf('day')
    .minus({ days: COMPLETED_DAYS - 1 })
    .toMillis()
  return rowsOf(groups, 'Done')
    .filter((item) => {
      const task = tasks.find((entry) => entry.id === item.session.taskId)
      return !task?.doneAt && (task?.lastActiveAt ?? 0) >= since
    })
    .slice(0, 50)
}

/** The rows of the given groups, in that order. */
export const rowsOf = (groups: Record<AgentGroup, AgentSessionInfo[]>, ...names: AgentGroup[]) =>
  names.flatMap((group) =>
    groups[group]
      .filter((session) => !session.parentId || group === 'Waiting for your input')
      .map((session) => ({ session, group })),
  )

export function HelperBreadcrumb({ parentId }: { parentId: string }) {
  const ws = useWorkspace()
  const { invoke } = useHost()
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
