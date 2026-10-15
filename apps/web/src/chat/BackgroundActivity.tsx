import { readBackgroundActivity } from './backgroundActivityState'
import { useEffect, useState } from 'react'
import { Bell, CircleCheck, Info, LoaderCircle, OctagonX, WifiOff, X } from 'lucide-react'
import { notices, useNotices } from './notificationCenter'
import type { BackgroundActivity as Activity } from '@ramu/shared/activity'
import { Button } from '@/components/desktop-button'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Separator } from '@/components/ui/separator'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { invoke, ramu } from '../ipc'
import { t, useLanguage } from '../i18n'
import { workspaceVisible, onWorkspaceVisibility } from '../workspace/workspaceLifetime'
import { errorText } from '../lib/errors'

/** Global activity remains visible on Home and in every checkout. */
export function BackgroundActivity() {
  useLanguage()
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
          () => invoke('background.status'),
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
      ramu.on('activity:changed', () => {
        void refresh()
      }),
      ramu.on('updates:changed', () => {
        void refresh()
      }),
      ramu.on('memory:changed', () => {
        void refresh()
      }),
      ramu.on('automation:changed', () => {
        void refresh()
      }),
      ramu.on('background:connection', ({ connected }) => {
        ++revision
        online = connected
        setConnected(connected)
        if (connected) void refresh()
        else setActivities([])
      }),
    ]
    void refresh()
    // Reconcile activity when reconnecting or an older service misses a push.
    const timer = setInterval(() => {
      if (online) void refresh()
    }, 3000)
    return () => {
      disposed = true
      clearInterval(timer)
      offs.forEach((off) => off())
    }
  }, [])
  const stop = async (id: string) => {
    await invoke('activity.cancel', id)
    const state = await readBackgroundActivity(
      () => invoke('activity.status'),
      () => invoke('background.status'),
    )
    setActivities(state.activities)
    setConnected(state.connected)
  }
  return <BackgroundActivityIndicator items={activities} connected={connected} onStop={stop} />
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
  const active = connected ? items : []
  const total = active.length + missed.length
  const summary = !connected
    ? t('Reconnecting…')
    : active.length
      ? t('{0} running', { 0: active.length })
      : t('No background activity')
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="ghost"
            className="status-activity ml-auto min-w-7 flex-none h-[22px] min-h-[22px] border-0 rounded-(--radius-s) bg-transparent px-1.5 py-0 gap-1 text-caption leading-[18px] text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:text-foreground aria-expanded:bg-hover [&_svg]:size-3.5"
          />
        }
        aria-label={t('Background activity')}
        aria-description={summary}
        title={`${t('Background activity')} · ${summary}`}
      >
        <Bell data-icon="inline-start" />
        {total > 0 && <span className="tabular-nums">{total}</span>}
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="activity-popover w-[360px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-48px)] overflow-hidden gap-0 p-0 rounded-(--radius-m) border border-edge bg-card text-foreground text-body ring-0 shadow-(--shadow-float)"
      >
        <PopoverHeader className="flex-row items-center gap-3 px-3.5 py-2.5">
          <PopoverTitle className="m-0 flex-1 text-control leading-5 font-semibold">
            {missed.length ? t('Notifications and activity') : t('Background activity')}
          </PopoverTitle>
          {missed.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-6 px-2 py-0 text-caption"
              onClick={() => {
                notices.clear()
                void invoke('notices.clear').catch(() => {})
              }}
            >
              {t('Clear all')}
            </Button>
          )}
          {active.length > 0 && <span className="text-caption text-muted-foreground tabular-nums">{summary}</span>}
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6 min-h-6 border-0 bg-transparent hover:bg-transparent shadow-none text-muted-foreground hover:text-foreground"
            aria-label={t('Close background activity')}
            onClick={() => setOpen(false)}
          >
            <X data-icon="inline-start" />
          </Button>
        </PopoverHeader>
        <Separator />
        <div role="status" aria-live="polite" className="min-h-0 overflow-y-auto overscroll-contain max-h-72">
          {missed.length > 0 && (
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
          )}
          {missed.length > 0 && active.length > 0 && <Separator />}
          {active.length ? (
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
          ) : missed.length ? null : (
            <Empty className="gap-2 rounded-none px-5 py-6">
              <EmptyHeader className="gap-1.5">
                <EmptyMedia className="mb-1 text-muted-foreground [&_svg]:size-5">
                  {connected ? <CircleCheck aria-hidden /> : <WifiOff aria-hidden />}
                </EmptyMedia>
                <EmptyTitle className="text-control font-medium">
                  {connected ? t('No background activity') : t('Reconnecting…')}
                </EmptyTitle>
                <EmptyDescription className="text-caption">
                  {connected
                    ? t('Background tasks will appear here.')
                    : t('Activity will appear when this computer reconnects.')}
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
