import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AgentSessionInfo } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
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
import { FeedSection } from './HomeSection'

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

/** `attention` (recaps that need you) sits right under the agents waiting for input, so everything that needs you reads together. */
export function HomeAgents({ attention }: { attention?: ReactNode }) {
  useLanguage()
  const ws = useWorkspace()
  const sessions = useQuery({
    queryKey: ipcQueryKey('agent.all'),
    queryFn: () => ramu.invoke('agent.all'),
    refetchInterval: 5000,
  })
  const reviews = useQuery({
    queryKey: ipcQueryKey('reviews.list'),
    queryFn: () => ramu.invoke('reviews.list'),
    refetchInterval: 10000,
  })
  const { refetch } = sessions
  useEffect(
    () =>
      ramu.on('workspace:changed', () => {
        void refetch()
      }),
    [refetch],
  )
  const [error, setError] = useState('')
  const [showCompleted, setShowCompleted] = useState(false)
  const open = (session: AgentSessionInfo) => {
    const parentId = session.nativeTask ? session.parentId! : session.id
    if (session.nativeTask)
      sessionStorage.setItem('ramu.open-helper', JSON.stringify({ parentId, agentId: session.nativeTask.agentId }))
    ws.openTask(session.taskId)
    ws.openView(session.taskId, { kind: 'agent', sessionId: parentId })
    if (session.nativeTask) requestAnimationFrame(() => window.dispatchEvent(new Event('ramu:open-helper')))
  }
  const group = (session: AgentSessionInfo) =>
    session.state === 'needs-input' || session.pendingInput
      ? 'Waiting for your input'
      : session.waitingUntil
        ? 'Waiting for allowance'
        : ['running', 'starting'].includes(session.state)
          ? 'Running'
          : 'Done'
  const rows = (sessions.data ?? []).filter((session) =>
    ws.tasks.some((task) => task.id === session.taskId && task.status !== 'archived'),
  )
  const renderGroup = (status: string) => {
    const members = rows.filter((session) => group(session) === status)
    if (!members.length) return null
    return (
      <FeedSection
        title={t(status === 'Running' ? 'Running in the background' : status)}
        count={members.length}
        label={t(status)}
      >
        {members.map((session) => {
          const task = ws.tasks.find((task) => task.id === session.taskId)!
          const project = ws.projects.find((project) => project.id === task.projectId)
          const changed = new Set(
            (reviews.data ?? [])
              .filter((review) => review.sessionId === (session.nativeTask ? session.parentId : session.id))
              .flatMap((review) => review.files.map((file) => `${file.repoId}:${file.path}`)),
          ).size
          return (
            <article key={session.id} className="flex flex-col gap-1 rounded-(--radius-m) bg-card p-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start! text-left"
                  onClick={() => open(session)}
                >
                  {session.parentId ? session.title || t('Helper') : task.title}
                </Button>
                {session.parentId && <Badge variant="secondary">{t('Helper')}</Badge>}
                {status !== 'Done' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground"
                    disabled={!!session.nativeTask && !session.nativeTask.canStop}
                    onClick={() => {
                      setError('')
                      void (
                        session.nativeTask
                          ? invoke('agent.stopTask', session.parentId!, session.nativeTask.agentId)
                          : invoke('agent.stop', session.id)
                      )
                        .then(() => refetch())
                        .catch((e) => setError(errorText(e)))
                    }}
                  >
                    {t('Stop')}
                  </Button>
                )}
              </div>
              <p className="text-caption text-muted-foreground">
                {project?.name ?? t('No project')} · {session.settings.model || session.provider} ·{' '}
                {t(session.nativeTask ? '{0} parent-thread changed files' : '{0} changed files', { 0: changed })}
              </p>
              {session.parentId && (
                <Button
                  variant="link"
                  size="sm"
                  className="self-start"
                  onClick={() => {
                    void invoke('agent.get', session.parentId!)
                      .then(open)
                      .catch((e) => notifyError(errorText(e)))
                  }}
                >
                  {t('Open parent thread')}
                </Button>
              )}
              {status === 'Waiting for your input' && <PendingInput sessionId={session.id} />}
            </article>
          )
        })}
      </FeedSection>
    )
  }
  const completed = rows.filter((session) => group(session) === 'Done').length
  if (!rows.length && !error && !sessions.error && !attention) return null
  return (
    <div className="home-agents mt-3 flex flex-col gap-4">
      {(error || sessions.error) && (
        <p role="alert" className="text-bad">
          {error || errorText(sessions.error)}
        </p>
      )}
      {['Waiting for your input', 'Running', 'Waiting for allowance'].map((status) => (
        <div key={status} className="contents">
          {renderGroup(status)}
          {status === 'Waiting for your input' && attention}
        </div>
      ))}
      {completed > 0 && (
        <Collapsible open={showCompleted} onOpenChange={setShowCompleted}>
          <CollapsibleTrigger render={<Button variant="link" size="sm" />}>
            {t(showCompleted ? 'Hide completed' : 'Show completed')} · {completed}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">{renderGroup('Done')}</CollapsibleContent>
        </Collapsible>
      )}
    </div>
  )
}

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
