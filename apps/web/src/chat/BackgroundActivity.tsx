import { readBackgroundActivity } from './backgroundActivityState'
import { useEffect, useState } from 'react'
import { Bell, CircleCheck, Info, LoaderCircle, OctagonX, WifiOff, X } from 'lucide-react'
import { notices, useNotices, useStatusPanel } from './notificationCenter'
import type { BackgroundActivity as Activity } from '@ramu/shared/chat/activity'
import { Button } from '@/components/desktop-button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { invoke as ownInvoke, ramu } from '../ipc'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { t, useLanguage } from '../i18n'
import { workspaceVisible, onWorkspaceVisibility } from '../workspace/workspaceLifetime'
import { errorText } from '../lib/errors'
import { useComputers } from '../workspace/computers'

/** Global activity remains visible on Home and in every checkout. */
export function BackgroundActivity() {
  useLanguage()
  // Activity and notices are the host's; the background service status is this window's own (main handles it).
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [activities, setActivities] = useState<Activity[]>([])
  const [connected, setConnected] = useState(true)
  useEffect(() => {
    let disposed = false,
      revision = 0,
      online = true,
      refreshing = false
    const refresh = async () => {
      if (!online || !workspaceVisible() || refreshing) return
      refreshing = true
      const request = ++revision
      try {
        const state = await readBackgroundActivity(
          () => invoke('activity.status'),
          () => ownInvoke('background.status'),
        )
        if (!disposed && request === revision) {
          online = state.connected
          setActivities(state.activities)
          setConnected(state.connected)
        }
      } finally {
        refreshing = false
      }
    }
    const offs = [
      onWorkspaceVisibility(() => {
        if (workspaceVisible()) void refresh()
      }),
      on('activity:changed', () => {
        void refresh()
      }),
      ramu.on('updates:changed', () => {
        void refresh()
      }),
      on('memory:changed', () => {
        void refresh()
      }),
      on('automation:changed', () => {
        void refresh()
      }),
      on('background:connection', ({ connected }) => {
        ++revision
        online = connected
        setConnected(connected)
        if (connected) void refresh()
        else setActivities([])
      }),
    ]
    void refresh()
    // Reconcile activity in case a push was missed.
    const timer = setInterval(() => {
      if (online) void refresh()
    }, 3000)
    return () => {
      disposed = true
      clearInterval(timer)
      offs.forEach((off) => off())
    }
  }, [invoke, on])
  const stop = async (id: string) => {
    await invoke('activity.cancel', id)
    const state = await readBackgroundActivity(
      () => invoke('activity.status'),
      () => ownInvoke('background.status'),
    )
    setActivities(state.activities)
    setConnected(state.connected)
  }
  return <BackgroundActivityIndicator items={activities} connected={connected} onStop={stop} />
}

function pressedToast({ reason, event }: { reason: string; event: Event }) {
  // Pressing a toast also moves focus into it, which closes the popover under its own reason.
  const target = reason === 'focus-out' ? (event as FocusEvent).relatedTarget : event.target
  return (
    (reason === 'outside-press' || reason === 'focus-out') &&
    target instanceof Element &&
    target.closest('[data-slot="toast-viewport"]') !== null
  )
}

export function BackgroundActivityIndicator({
  items,
  connected = true,
  onStop,
}: {
  items: Activity[]
  connected?: boolean
  onStop?: (id: string) => Promise<void>
}) {
  useLanguage()
  const [open, setOpen] = useState(false)
  const panelRef = useStatusPanel('notifications', open)
  const [stopping, setStopping] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const stop = async (id: string) => {
    if (!onStop || stopping.has(id)) return
    setStopping((current) => new Set(current).add(id))
    setError(null)
    try {
      await onStop(id)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setStopping((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }
  const missed = useNotices()
  // A computer that rejected this device never comes back by itself, so it is not "reconnecting".
  const host = useHost()
  const computers = useComputers()
  const rejected = computers?.computers.find((computer) => computer.id === host.id)?.status === 'rejected'
  const disconnected = rejected ? t('Pair again') : t('Reconnecting…')
  const active = connected ? items : []
  const summary = !connected
    ? disconnected
    : active.length
      ? t('{0} running', { 0: active.length })
      : t('No background activity')
  const activityLabel = !connected ? disconnected : active.length === 1 ? t(active[0]!.label) : summary
  const notificationSummary = missed.length === 1 ? t('1 notification') : t('{0} notifications', { 0: missed.length })
  return (
    <Popover
      open={open}
      onOpenChange={(next, details) => {
        // Closing would move the toast out from under the click that is pressing it.
        if (!next && pressedToast(details)) return
        setOpen(next)
      }}
    >
      <div className="ml-auto flex min-w-0 max-w-[240px] items-center gap-1">
        {(!connected || active.length > 0) && (
          <>
            {/* Not a second trigger: the panel stays anchored to the bell, which is always there. Anchored here, it
                lost its place and jumped to the window's corner when the running task ended while it was open. */}
            <Button
              variant="ghost"
              className="min-w-0 shrink h-[22px] min-h-[22px] rounded-(--radius-s) px-1.5 py-0 gap-1.5 text-caption! leading-[18px] text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover [&_svg]:size-3.5"
              aria-label={t('Background activity')}
              aria-description={summary}
              aria-haspopup="dialog"
              aria-expanded={open}
              title={activityLabel}
              onClick={() => setOpen(true)}
            >
              {connected ? (
                <LoaderCircle data-icon="inline-start" className="text-brand animate-spin motion-reduce:animate-none" />
              ) : (
                <WifiOff data-icon="inline-start" />
              )}
              <span className="truncate">{activityLabel}</span>
            </Button>
          </>
        )}
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              className="status-activity min-w-7 flex-none h-[22px] min-h-[22px] border-0 rounded-(--radius-s) bg-transparent px-1.5 py-0 gap-1 text-caption! leading-[18px] text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:text-foreground aria-expanded:bg-hover [&_svg]:size-3.5"
            />
          }
          aria-label={t('Notifications')}
          aria-description={notificationSummary}
          title={`${t('Notifications')} · ${notificationSummary}`}
        >
          <Bell data-icon="inline-start" />
          {missed.length > 0 && <span className="tabular-nums">{missed.length}</span>}
        </PopoverTrigger>
      </div>
      <PopoverContent
        ref={panelRef}
        side="top"
        align="end"
        sideOffset={8}
        className="activity-popover w-[360px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-48px)] overflow-hidden gap-0 p-0 rounded-(--radius-m) border border-edge bg-card text-foreground text-body ring-0 shadow-(--shadow-float)"
      >
        <PopoverHeader className="flex-row items-center gap-3 px-3.5 py-2.5">
          <PopoverTitle className="m-0 flex-1 text-control leading-5 font-semibold">
            {t('Notifications and activity')}
          </PopoverTitle>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 min-h-6 border-0 bg-transparent hover:bg-transparent shadow-none text-muted-foreground hover:text-foreground"
            aria-label={t('Close notifications and activity')}
            onClick={() => setOpen(false)}
          >
            <X data-icon="inline-start" />
          </Button>
        </PopoverHeader>
        <Separator />
        <div role="status" aria-live="polite" className="min-h-0 overflow-y-auto overscroll-contain max-h-72">
          {!connected && missed.length > 0 && (
            <div className="flex items-center gap-2 px-3.5 py-3 text-caption text-muted-foreground">
              <WifiOff aria-hidden className="size-3.5 shrink-0" />
              {disconnected}
            </div>
          )}
          {active.length > 0 && (
            <section aria-label={t('Running')}>
              <h3 className="m-0 flex items-center gap-2 px-3.5 pt-3 text-caption font-normal text-muted-foreground">
                {t('Running')} <span className="tabular-nums">{active.length}</span>
              </h3>
              <ul className="m-0 flex list-none flex-col gap-1 p-2">
                {active.map((item) => (
                  <li key={item.id} className="flex items-start gap-2.5 rounded-(--radius-s) px-1.5 py-2">
                    <LoaderCircle
                      aria-hidden
                      className="size-3.5 shrink-0 mt-0.5 text-brand animate-spin motion-reduce:animate-none"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-control leading-5">{t(item.label)}</div>
                      {item.detail && (
                        <div className="mt-0.5 text-caption leading-[1.5] text-muted-foreground wrap-anywhere select-text">
                          {item.detail}
                        </div>
                      )}
                    </div>
                    {item.cancellable && onStop && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-6 px-2 py-0 text-caption"
                        disabled={stopping.has(item.id)}
                        aria-label={t('Stop {0}', { 0: t(item.label) })}
                        onClick={() => void stop(item.id)}
                      >
                        {stopping.has(item.id) ? t('Stopping…') : t('Stop')}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {missed.length > 0 && active.length > 0 && <Separator />}
          {missed.length > 0 && (
            <section aria-label={t('Notifications')}>
              <div className="flex items-center gap-2 px-3.5 pt-2">
                <h3 className="m-0 flex flex-1 items-center gap-2 text-caption font-normal text-muted-foreground">
                  {t('Notifications')} <span className="tabular-nums">{missed.length}</span>
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  className="min-h-6 px-2 py-0 text-caption"
                  onClick={() => {
                    notices.clear()
                    void host.invoke('notices.clear').catch(() => {})
                  }}
                >
                  {t('Clear all')}
                </Button>
              </div>
              <ul className="m-0 flex list-none flex-col gap-1 p-2">
                {missed.map((notice) => (
                  <li key={notice.id} className="flex items-start gap-2.5 rounded-(--radius-s) px-1.5 py-2">
                    <span aria-hidden className="mt-0.5 shrink-0 text-muted-foreground [&_svg]:size-3.5">
                      {notice.icon ??
                        (notice.type === 'error' ? (
                          <OctagonX className="text-destructive" />
                        ) : notice.type === 'success' ? (
                          <CircleCheck className="text-[var(--ok)]" />
                        ) : (
                          <Info />
                        ))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-control leading-5">{notice.title}</div>
                      {notice.description && (
                        <div className="mt-0.5 text-caption leading-[1.5] text-muted-foreground wrap-anywhere select-text">
                          {notice.description}
                        </div>
                      )}
                    </div>
                    {notice.onSecondary && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-6 px-2 py-0 text-caption text-muted-foreground"
                        onClick={notice.onSecondary}
                      >
                        {notice.secondaryLabel}
                      </Button>
                    )}
                    {notice.onAction && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="min-h-6 px-2 py-0 text-caption"
                        onClick={notice.onAction}
                      >
                        {notice.actionLabel}
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-6 min-h-6 border-0 bg-transparent hover:bg-transparent shadow-none text-muted-foreground hover:text-foreground"
                      aria-label={t('Dismiss notification')}
                      onClick={() => (notice.onDismiss ?? (() => notices.remove(notice.id)))()}
                    >
                      <X data-icon="inline-start" />
                    </Button>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {active.length === 0 && missed.length === 0 && (
            <Empty className="gap-2 rounded-none px-5 py-6">
              <EmptyHeader className="gap-1.5">
                <EmptyMedia className="mb-1 text-muted-foreground [&_svg]:size-5">
                  {connected ? <CircleCheck aria-hidden /> : <WifiOff aria-hidden />}
                </EmptyMedia>
                <EmptyTitle className="text-control font-medium">
                  {connected ? t('You are all caught up') : disconnected}
                </EmptyTitle>
                <EmptyDescription className="text-caption">
                  {connected
                    ? t('Notifications and background tasks will appear here.')
                    : t('Activity will appear when this host reconnects.')}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
        {error && (
          <p className="m-0 px-3.5 pb-3 text-caption text-bad" role="alert">
            {error}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
