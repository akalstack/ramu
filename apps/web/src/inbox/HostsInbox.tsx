import { Brief, blockerLabel } from './Brief'
import { useInboxModel } from './useBrief'
import { useState, useEffect } from 'react'
import { inboxBlocker, INBOX_TABS, type InboxChat, type InboxTab } from '@ramu/shared/hostInbox'
import { HostProvider } from '../workspace/HostProvider'
import { ThreadHoverCard } from '../sidebar/projects/ThreadHoverCard'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import { Check, Inbox, Loader, Sparkles } from 'lucide-react'
import { HostNotice, InboxEmpty, InboxList, InboxMark, InboxRow, InboxTabsList, byDay } from './InboxParts'
import { useHostSelection } from '../workspace/HostSelection'
import { FeedSection } from '../HomeSection'
import { t, useLanguage } from '../i18n'
import { timeAgo } from '../Menu'
import { StateDot, StatusMark } from '../sidebar/projects/TaskStateIcon'
import { threadStatus } from '@ramu/shared/chat/threadStatus'
import { savedInboxTab, saveInboxTab } from './navigation'

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
  const chats = (list: InboxChat[]) => (
    <InboxList>
      {list.map((chat) => {
        const task = data(chat.computerId)?.tasks.find((entry) => entry.id === chat.taskId)
        const status = task ? threadStatus(task, false, task.goalState) : null
        const blocker = blockerText(chat)
        return (
          <HostProvider key={JSON.stringify([chat.computerId, chat.id])} hostId={chat.computerId}>
            <InboxRow
              label={task?.title}
              mark={
                task && status ? (
                  <InboxMark>
                    <StatusMark task={task} status={status} />
                  </InboxMark>
                ) : (
                  <InboxMark tone="ok">
                    <Check />
                  </InboxMark>
                )
              }
              title={task?.title}
              // A finished thread's newest recap says what it did, where Completed lists it.
              meta={[
                blocker,
                where(chat.computerId, chat.taskId),
                model.recent.find((r) => r.computerId === chat.computerId && r.item.taskId === chat.taskId)?.item.title,
              ]
                .filter(Boolean)
                .join(' · ')}
              at={chat.lastActiveAt}
              disabled={!available(chat.computerId)}
              onOpen={() =>
                select(chat.computerId, {
                  kind: 'task',
                  taskId: chat.taskId,
                  ...(chat.sessionId ? { sessionId: chat.sessionId } : {}),
                })
              }
              hoverCard={
                task && (
                  <ThreadHoverCard
                    task={task}
                    status={status}
                    hostName={pc(chat.computerId)?.name}
                    sharedWorkspace={
                      !!task.workspaceId &&
                      !!data(chat.computerId)?.tasks.some(
                        (other) => other.id !== task.id && other.workspaceId === task.workspaceId,
                      )
                    }
                    offline={!available(chat.computerId)}
                  />
                )
              }
            />
          </HostProvider>
        )
      })}
    </InboxList>
  )
  const scopedHosts = hosts.filter((entry) => !host || entry.id === host)
  const pending = scopedHosts.some((entry) => available(entry.id) && entry.isPending)
  const counts: Record<InboxTab, number> = {
    brief: model.needsYou,
    running: model.running.length,
    learned: model.unreadSummaries,
    completed: model.completed.length,
  }
  const labels: Record<InboxTab, string> = {
    brief: t('Brief'),
    running: t('Running'),
    learned: t('Learned'),
    completed: t('Completed'),
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5 px-6 pt-6 pb-10">
        <Tabs value={tab} onValueChange={(value) => choose(value as InboxTab)} className="flex-col gap-5">
          <InboxTabsList tabs={INBOX_TABS.map((id) => ({ id, label: labels[id], count: counts[id] }))} />
          <TabsContent value={tab} className="flex flex-col gap-5">
            {scopedHosts.map((entry) => {
              const computer = pc(entry.id)
              if (!computer || (available(entry.id) && !entry.error && !entry.data?.errors.length)) return null
              return (
                <HostNotice
                  key={entry.id}
                  name={computer.name}
                  status={computer.status}
                  stale={!available(entry.id) && !!entry.data}
                  failed={available(entry.id)}
                  {...(available(entry.id) ? { onRetry: () => void entry.refetch() } : {})}
                />
              )
            })}
            {pending && (
              <p role="status" className="text-caption text-muted-foreground">
                {t('Loading…')}
              </p>
            )}
            {tab === 'brief' && <Brief />}
            {tab === 'running' && model.running.length > 0 && chats(model.running)}
            {tab === 'learned' && model.summaries.length > 0 && (
              <InboxList>
                {model.summaries.map(({ computerId, summary }) => (
                  <InboxRow
                    key={JSON.stringify([computerId, summary.id])}
                    mark={
                      <InboxMark>
                        <Sparkles />
                      </InboxMark>
                    }
                    title={summary.headline}
                    meta={[t('{0} changes', { 0: summary.items.length }), where(computerId)].join(' · ')}
                    at={summary.periodEnd}
                    {...(summary.status === 'unread'
                      ? {
                          trailing: (
                            <span className="flex flex-none items-center gap-2">
                              <StateDot kind="dot unread" label={t('Unread')} />
                              <span className="min-w-6 text-right text-caption text-muted-foreground tabular-nums">
                                {timeAgo(summary.periodEnd)}
                              </span>
                            </span>
                          ),
                        }
                      : {})}
                    disabled={!available(computerId)}
                    onOpen={() => select(computerId, { kind: 'summary', summaryId: summary.id })}
                  />
                ))}
              </InboxList>
            )}
            {tab === 'completed' &&
              byDay(model.completed, (chat) => chat.lastActiveAt).map((day) => (
                <FeedSection key={day.label} title={day.label} count={day.items.length}>
                  {chats(day.items)}
                </FeedSection>
              ))}
            {!pending && tab !== 'brief' && (tab === 'learned' ? !model.summaries.length : !counts[tab]) && (
              <InboxEmpty {...emptyTab(tab)} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

/** What an empty tab will hold, in the same words one host's Inbox uses. */
function emptyTab(tab: Exclude<InboxTab, 'brief'>): { icon: React.ReactNode; title: string; detail: string } {
  switch (tab) {
    case 'running':
      return {
        icon: <Loader />,
        title: t('No agents running'),
        detail: t('Threads and sub-agents that are working or waiting on a usage limit appear here.'),
      }
    case 'learned':
      return {
        icon: <Sparkles />,
        title: t('No summaries yet'),
        detail: t('Ramu summarizes the memories and skills it saves from your threads.'),
      }
    case 'completed':
      return {
        icon: <Inbox />,
        title: t('Nothing finished this week'),
        detail: t('Threads finished in the last 7 days are listed here. Older ones stay in the sidebar.'),
      }
  }
}

/** One line saying what a waiting thread needs from the person; empty for a thread that is not waiting. */
function blockerText(chat: InboxChat): string {
  const blocker = inboxBlocker(chat)
  return blocker ? blockerLabel(blocker) : ''
}
