import { RowButton } from '@/components/row-button'
import { Brief, blockerLabel } from './Brief'
import { RunningTab } from './Resources'
import { useInboxModel } from './useBrief'
import { useState, useEffect } from 'react'
import { inboxBlocker, INBOX_TABS, type InboxChat, type InboxTab } from '@ramu/shared/hostInbox'
import type { Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { HoverCard, HoverCardTrigger } from '@/components/ui/hover-card'
import { HostProvider } from '../workspace/HostProvider'
import { ThreadHoverCard } from '../sidebar/projects/ThreadHoverCard'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { statusText } from '../workspace/computers'
import { useHostSelection } from '../workspace/HostSelection'
import { FeedSection } from '../HomeSection'
import { t, useLanguage } from '../i18n'
import { timeAgo } from '../Menu'
import { StatusMark } from '../sidebar/projects/TaskStateIcon'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { savedInboxTab, saveInboxTab } from './navigation'
import { SnoozeMenu, notifyRecapAction, type RecapAction } from './recaps'
import { ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'

/** All sections are derived after host filtering, including counts and limits. Actions always carry the owning host. */
export function HostsInbox() {
  useLanguage()
  const { select } = useHostSelection()
  const { model, hosts, computers } = useInboxModel()
  const host = computers?.scope ?? null
  const [tab, setTab] = useState<InboxTab>(savedInboxTab)
  useEffect(() => {
    const onTab = (event: Event) => setTab((event as CustomEvent<InboxTab>).detail)
    window.addEventListener('ramu:inbox-tab', onTab)
    return () => window.removeEventListener('ramu:inbox-tab', onTab)
  }, [])
  const choose = (value: InboxTab) => {
    setTab(value)
    saveInboxTab(value)
  }
  const pc = (id: string) => computers?.computers.find((c) => c.id === id)
  const data = (id: string) => hosts.find((entry) => entry.id === id)?.data
  const where = (id: string, taskId?: string) => {
    const snapshot = data(id)
    const task = snapshot?.tasks.find((task) => task.id === taskId)
    const project = snapshot?.projects.find((p) => p.id === task?.projectId)
    return [project?.name, pc(id)?.name].filter(Boolean).join(' · ')
  }
  const available = (id: string) => pc(id)?.status === 'connected'
  // The same status as the sidebar, including goal states; a finished result shows its age instead of a mark.
  const state = (task?: Task) => {
    if (!task) return null
    const status = threadStatus(task, false, task.goalState)
    return status ? <StatusMark task={task} status={status} /> : null
  }
  const chats = (list: InboxChat[]) =>
    list.map((chat) => {
      const task = data(chat.computerId)?.tasks.find((entry) => entry.id === chat.taskId)
      return (
        <HostProvider key={JSON.stringify([chat.computerId, chat.id])} hostId={chat.computerId}>
          <HoverCard open={!task ? false : undefined}>
            <HoverCardTrigger
              render={<RowButton size="lg" disabled={!available(chat.computerId)} focusableWhenDisabled />}
              delay={400}
              closeDelay={120}
              aria-disabled={!available(chat.computerId)}
              onClick={() =>
                available(chat.computerId) &&
                select(chat.computerId, {
                  kind: 'task',
                  taskId: chat.taskId,
                  ...(chat.sessionId ? { sessionId: chat.sessionId } : {}),
                })
              }
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">{task?.title}</span>
                <span className="block truncate text-caption text-muted-foreground">
                  {where(chat.computerId, chat.taskId)}
                </span>
                {blockerText(chat) && (
                  <span className="block truncate text-caption text-foreground/80">{blockerText(chat)}</span>
                )}
              </span>
              {state(task)}
              <span className="min-w-6 flex-none text-right text-caption text-muted-foreground tabular-nums">
                {timeAgo(chat.lastActiveAt)}
              </span>
            </HoverCardTrigger>
            {task && (
              <ThreadHoverCard
                task={task}
                status={threadStatus(task, false, task.goalState)}
                hostName={pc(chat.computerId)?.name}
                sharedWorkspace={
                  !!task.workspaceId &&
                  !!data(chat.computerId)?.tasks.some(
                    (other) => other.id !== task.id && other.workspaceId === task.workspaceId,
                  )
                }
                offline={!available(chat.computerId)}
              />
            )}
          </HoverCard>
        </HostProvider>
      )
    })
  const actRecap = async (id: string, recapId: string, action: RecapAction, until?: number) => {
    const send = (next: 'open' | RecapAction, at?: number) =>
      at === undefined
        ? ramu.invoke('computers.recapAct', id, recapId, next)
        : ramu.invoke('computers.recapAct', id, recapId, next, at)
    try {
      await send(action, until)
      await hosts.find((entry) => entry.id === id)?.refetch()
      notifyRecapAction(action, () => {
        send('open')
          .then(() => hosts.find((entry) => entry.id === id)?.refetch())
          .catch((error) => notifyError(errorText(error), t('Recaps')))
      })
    } catch (error) {
      notifyError(errorText(error), t('Recaps'))
    }
  }
  const recaps = (list: typeof model.attention) =>
    list.map(({ computerId, item }) => (
      <article key={JSON.stringify([computerId, item.id])} className="rounded-(--radius-m) bg-card p-4">
        <p className="mb-1 text-caption text-muted-foreground">{where(computerId, item.taskId)}</p>
        <h3 className="text-body font-medium">{item.title}</h3>
        <p className="my-2 text-body text-muted-foreground">{item.detail}</p>
        <Button
          variant="secondary"
          size="sm"
          disabled={!available(computerId)}
          onClick={() => select(computerId, { kind: 'task', taskId: item.taskId, sessionId: item.sessionId })}
        >
          {t('Open thread')}
        </Button>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={!available(computerId)}
            onClick={() => void actRecap(computerId, item.id, 'done')}
          >
            {t('Done')}
          </Button>
          <SnoozeMenu
            disabled={!available(computerId)}
            onSnooze={(until) => void actRecap(computerId, item.id, 'snoozed', until)}
          />
          <Button
            variant="ghost"
            size="sm"
            disabled={!available(computerId)}
            onClick={() => void actRecap(computerId, item.id, 'dismissed')}
          >
            {t('Dismiss')}
          </Button>
        </div>
      </article>
    ))
  const section = (id: InboxTab, title: string, count: number, children: React.ReactNode) =>
    count && tab === id ? (
      <FeedSection title={title} count={count}>
        {children}
      </FeedSection>
    ) : null
  const scopedHosts = hosts.filter((entry) => !host || entry.id === host)
  const pending = scopedHosts.some((entry) => available(entry.id) && entry.isPending)
  const counts: Record<InboxTab, number> = {
    brief: model.needsYou,
    running: model.running.length,
    recaps: model.recent.length,
    learned: model.unreadSummaries,
    completed: model.completed.length,
  }
  const labels: Record<InboxTab, string> = {
    brief: t('Brief'),
    running: t('Running'),
    recaps: t('Recaps'),
    learned: t('Learned'),
    completed: t('Completed'),
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pt-6 pb-10">
        <Tabs value={tab} onValueChange={(value) => choose(value as InboxTab)} className="flex-col gap-5">
          <TabsList variant="line" className="h-auto flex-wrap justify-start gap-3">
            {INBOX_TABS.map((id) => (
              <TabsTrigger key={id} value={id}>
                {labels[id]}
                {counts[id] ? ` · ${counts[id]}` : ''}
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={tab} className="flex flex-col gap-5">
            {scopedHosts.map((entry) =>
              !available(entry.id) || entry.error || entry.data?.errors.length ? (
                <p key={entry.id} role="status" className="text-caption text-muted-foreground">
                  {pc(entry.id)?.name} ·{' '}
                  {!available(entry.id)
                    ? `${statusText(pc(entry.id)!.status)}${entry.data ? ` · ${t('Last known activity')}` : ''}`
                    : t('Some host activity could not be loaded.')}
                  {available(entry.id) && (
                    <Button variant="ghost" size="sm" onClick={() => void entry.refetch()}>
                      {t('Retry')}
                    </Button>
                  )}
                </p>
              ) : null,
            )}
            {pending && (
              <p role="status" className="text-caption text-muted-foreground">
                {t('Loading…')}
              </p>
            )}
            {tab === 'brief' && <Brief />}
            {tab === 'running' && (
              <RunningTab>
                {(listed) => {
                  const rest = model.running.filter(
                    (chat) => !listed.has(JSON.stringify([chat.computerId, chat.taskId])),
                  )
                  return section('running', t('Running in the background'), rest.length, chats(rest))
                }}
              </RunningTab>
            )}
            {section('recaps', t('Since your last visit'), model.sinceVisit.length, recaps(model.sinceVisit))}
            {tab === 'recaps' && section('recaps', t('Earlier'), model.earlier.length, recaps(model.earlier))}
            {section(
              'learned',
              t('What Ramu learned'),
              model.summaries.length,
              model.summaries.map(({ computerId, summary }) => (
                <RowButton
                  size="lg"
                  key={JSON.stringify([computerId, summary.id])}
                  disabled={!available(computerId)}
                  onClick={() => select(computerId, { kind: 'summary', summaryId: summary.id })}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{summary.headline}</span>
                    <span className="text-caption text-muted-foreground">{where(computerId)}</span>
                  </span>
                  <span className="text-caption text-muted-foreground">
                    {summary.status === 'unread' ? t('Unread') : timeAgo(summary.periodEnd)}
                  </span>
                </RowButton>
              )),
            )}
            {section('completed', t('Completed'), model.completed.length, chats(model.completed))}
            {!pending && tab !== 'brief' && (tab === 'learned' ? !model.summaries.length : !counts[tab]) && (
              <p className="py-12 text-center text-body text-muted-foreground">{t('Nothing here yet')}</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/** One line saying what a waiting thread needs from the person; empty for a thread that is not waiting. */
function blockerText(chat: InboxChat): string {
  const blocker = inboxBlocker(chat)
  return blocker ? blockerLabel(blocker) : ''
}
