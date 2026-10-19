import { useState, useEffect } from 'react'
import { buildInbox, INBOX_TABS, type InboxChat, type InboxTab } from '@ramu/shared/hostInbox'
import { hostInboxInput } from '@ramu/shared/hostOverview'
import type { Task } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useComputers, statusText } from '../workspace/computers'
import { useHostOverviews } from '../workspace/hostOverview'
import { useHostSelection } from '../workspace/HostSelection'
import { FeedSection } from '../HomeSection'
import { t, useLanguage } from '../i18n'
import { timeAgo } from '../Menu'
import { StateDot } from '../sidebar/projects/TaskStateIcon'
import { ProviderWaitIcon } from '../models/ProviderWait'
import { savedInboxTab, saveInboxTab } from './navigation'
import { SnoozeMenu, notifyRecapAction, type RecapAction } from './recaps'
import { ramu } from '../ipc'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'

/** All sections are derived after host filtering, including counts and limits. Actions always carry the owning host. */
export function HostsInbox() {
  useLanguage()
  const computers = useComputers()
  const { select } = useHostSelection()
  const host = computers?.scope ?? null
  const hosts = useHostOverviews(computers?.computers.map((c) => c.id) ?? [])
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
  const model = buildInbox({
    ...hostInboxInput(hosts),
    computerId: host,
    visit: Number(localStorage.getItem('ramu.last-visit') ?? 0),
  })
  const pc = (id: string) => computers?.computers.find((c) => c.id === id)
  const data = (id: string) => hosts.find((entry) => entry.id === id)?.data
  const where = (id: string, taskId?: string) => {
    const snapshot = data(id)
    const task = snapshot?.tasks.find((task) => task.id === taskId)
    const project = snapshot?.projects.find((p) => p.id === task?.projectId)
    return [project?.name, pc(id)?.name].filter(Boolean).join(' · ')
  }
  const available = (id: string) => pc(id)?.status === 'connected'
  const shown = <T,>(list: T[]) => (tab === 'all' ? list.slice(0, 5) : list)
  const row =
    'flex min-h-12 w-full cursor-default items-center gap-3 rounded-(--radius-s) border-0 bg-transparent px-2.5 py-1.5 text-left text-body leading-5 text-soft hover:bg-accent hover:text-foreground disabled:opacity-60'
  const state = (task?: Task) => {
    if (!task) return null
    if (task.status === 'running') return <StateDot kind="spinner" label={t('Agent working')} />
    if (task.status === 'needs-input') return <StateDot kind="dot warn text-warn" label={t('Waiting for your input')} />
    if (task.waitingUntil) return <ProviderWaitIcon retryAt={task.waitingUntil} />
    if (task.status === 'failed') return <StateDot kind="dot bad" label={t('Agent failed')} />
    return null
  }
  const chats = (list: InboxChat[]) =>
    shown(list).map((chat) => {
      const task = data(chat.computerId)?.tasks.find((entry) => entry.id === chat.taskId)
      return (
        <button
          key={chat.id}
          className={row}
          disabled={!available(chat.computerId)}
          onClick={() =>
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
          </span>
          {state(task)}
          <span className="min-w-6 flex-none text-right text-caption text-muted-foreground tabular-nums">
            {timeAgo(chat.lastActiveAt)}
          </span>
        </button>
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
    shown(list).map(({ computerId, item }) => (
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
    count && (tab === 'all' || tab === id) ? (
      <FeedSection
        title={title}
        count={count}
        action={
          tab === 'all' && count > 5 ? (
            <Button variant="ghost" size="sm" onClick={() => choose(id)}>
              {t('See all')}
            </Button>
          ) : undefined
        }
      >
        {children}
      </FeedSection>
    ) : null
  const scopedHosts = hosts.filter((entry) => !host || entry.id === host)
  const pending = scopedHosts.some((entry) => available(entry.id) && entry.isPending)
  const counts: Record<InboxTab, number> = {
    all: 0,
    'needs-you': model.needsYou,
    running: model.running.length,
    recaps: model.recent.length,
    learned: model.unreadSummaries,
    completed: model.completed.length,
  }
  const labels: Record<InboxTab, string> = {
    all: t('All'),
    'needs-you': t('Waiting'),
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
            {section('needs-you', t('Waiting for your input'), model.waiting.length, chats(model.waiting))}
            {section('needs-you', t('Needs your attention'), model.attention.length, recaps(model.attention))}
            {section('running', t('Running in the background'), model.running.length, chats(model.running))}
            {section('recaps', t('Since your last visit'), model.sinceVisit.length, recaps(model.sinceVisit))}
            {tab === 'recaps' && section('recaps', t('Earlier'), model.earlier.length, recaps(model.earlier))}
            {section(
              'learned',
              t('What Ramu learned'),
              model.summaries.length,
              shown(model.summaries).map(({ computerId, summary }) => (
                <button
                  key={JSON.stringify([computerId, summary.id])}
                  className={row}
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
                </button>
              )),
            )}
            {section('completed', t('Completed'), model.completed.length, chats(model.completed))}
            {!pending && (tab === 'all' ? model.empty : tab === 'learned' ? !model.summaries.length : !counts[tab]) && (
              <p className="py-12 text-center text-body text-muted-foreground">{t('Nothing here yet')}</p>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
