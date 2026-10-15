import { t, useLanguage, formatLocale } from '../i18n'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import { cn } from 'cn'
import { Gauge } from 'lucide-react'
import { Fragment, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AgentProvider, ContextUsage, UsageReading } from '@ramu/shared/types'
import { providerAccountOrder, providerEnabled, providerName } from '@ramu/shared/providers'
import { invoke, ramu } from '../ipc'
import { ProviderIcon } from '../models/ProviderIcon'
import { useAppSettings } from './AppSettings'
import { workspaceVisible, onWorkspaceVisibility } from '../workspace/workspaceLifetime'

// One shared copy of the account's plan usage; the main process pushes every change.
let readings: UsageReading[] = []
let started = false
const listeners = new Set<() => void>()
const publish = (next: UsageReading[]) => {
  readings = next
  listeners.forEach((listener) => listener())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    started = true
    void invoke('usage.get').then(publish, () => {})
    // Claude's usage can be read without a turn, so the gauges are right on open.
    void invoke('usage.refresh').then(publish, () => {})
    ramu.on('usage:changed', publish)
    // Keep the gauges current between turns: poll while the window is visible and catch up when it regains focus.
    // The main process throttles the actual read, so extra calls are cheap.
    let refreshing = false
    const refresh = () => {
      if (workspaceVisible() && document.visibilityState === 'visible' && listeners.size && !refreshing) {
        refreshing = true
        void invoke('usage.refresh')
          .then(publish, () => {})
          .finally(() => {
            refreshing = false
          })
      }
    }
    onWorkspaceVisibility(refresh)
    window.setInterval(refresh, 5 * 60_000 + 5_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    ramu.on('background:connection', ({ connected }) => {
      if (connected) void invoke('usage.get').then(publish, () => {})
    })
  }
  return () => {
    listeners.delete(listener)
  }
}
export function useUsage(): UsageReading[] {
  const language = useLanguage()
  return useSyncExternalStore(subscribe, () => readings)
}

/** Readings for every login of every provider; the shared copy above only holds the selected one. Reloads when usage changes. */
export function useAccountUsage(enabled = true): UsageReading[] {
  const [all, setAll] = useState<UsageReading[]>([])
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () => {
      void invoke('usage.accounts').then(
        (next) => {
          if (!cancelled) setAll(next)
        },
        () => {},
      )
    }
    load()
    const off = ramu.on('usage:changed', load)
    return () => {
      cancelled = true
      off()
    }
  }, [enabled])
  return all
}

/** The login's name as the user knows it: the default CLI login, or the name given when it was added. */
export function accountLabel(config: { accounts?: { id: string; name: string }[] } | undefined, id: string): string {
  return id === 'default'
    ? t('Default CLI account')
    : (config?.accounts?.find((account) => account.id === id)?.name ?? id)
}

/** Readings older than this are shown with their age; providers only report while they run. */
const STALE_MS = 10 * 60_000

export type UsageTone = 'ok' | 'warn' | 'bad'
export function usageTone(reading: Pick<UsageReading, 'usedPercent' | 'status'>): UsageTone {
  return reading.status === 'limited' || reading.usedPercent >= 90 ? 'bad' : reading.usedPercent >= 70 ? 'warn' : 'ok'
}

/** Usage for providers that are turned on; a turned-off provider shows no gauge. */
function useVisibleUsage(): UsageReading[] {
  const { preferences } = useAppSettings()
  return useUsage().filter((reading) => providerEnabled(preferences.providerBinaries, reading.provider))
}

/** Provider order on screen: the two subscription providers first. */
const ORDER: AgentProvider[] = ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']
function byProvider(
  all: UsageReading[],
): { provider: AgentProvider; five?: UsageReading; weekly?: UsageReading; scoped: UsageReading[] }[] {
  return ORDER.flatMap((provider) => {
    const own = all.filter((reading) => reading.provider === provider)
    if (!own.length) return []
    return [
      {
        provider,
        five: own.find((r) => r.window === 'five_hour' && !r.scope),
        weekly: own.find((r) => (r.window === 'weekly' || r.window === 'monthly') && !r.scope),
        scoped: own.filter((r) => r.scope),
      },
    ]
  })
}

/** The highest window for a provider, which decides warnings and fallback. */
export function peakUsage(all: UsageReading[], provider: AgentProvider): UsageReading | undefined {
  return all.filter((reading) => reading.provider === provider).sort((a, b) => b.usedPercent - a.usedPercent)[0]
}

export function windowLabel(reading: UsageReading, short = false): string {
  const base =
    reading.window === 'five_hour'
      ? short
        ? t('5h')
        : t('5-hour')
      : reading.window === 'monthly'
        ? short
          ? t('mo')
          : t('Monthly')
        : short
          ? t('wk')
          : t('Weekly')
  return reading.scope ? `${reading.scope} ${short ? base : base.toLowerCase()}` : base
}

export function resetText(at: number | undefined, now = Date.now()): string | null {
  if (!at) return null
  const ms = at - now
  if (ms <= 0) return t('resets now')
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return t('resets in {minutes}m', { minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('resets in {hours}h {minutes}m', { hours, minutes: minutes % 60 })
  return t('resets {date}', {
    date: new Date(at).toLocaleString(formatLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }),
  })
}

function ageText(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  return minutes < 1
    ? t('just now')
    : minutes < 60
      ? t('{minutes} min ago', { minutes })
      : minutes < 1440
        ? t('{hours} h ago', { hours: Math.round(minutes / 60) })
        : new Date(at).toLocaleDateString(formatLocale())
}

const toneText: Record<UsageTone, string> = { ok: 'text-soft', warn: 'text-warn', bad: 'text-bad' }
const toneFill: Record<UsageTone, string> = {
  ok: '[&_[data-slot=progress-indicator]]:bg-brand',
  warn: '[&_[data-slot=progress-indicator]]:bg-warn',
  bad: '[&_[data-slot=progress-indicator]]:bg-bad',
}
const toneStroke: Record<UsageTone, string> = { ok: 'stroke-brand', warn: 'stroke-warn', bad: 'stroke-bad' }

/** A 14px ring for status-bar meters: a faint track and a filled arc. */
function Ring({ percent, className }: { percent: number; className: string }) {
  const r = 5.5,
    c = 2 * Math.PI * r
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" className="size-3.5 fill-none stroke-[2.2]" aria-hidden="true">
      <circle cx="7" cy="7" r={r} className="stroke-foreground/14" />
      <circle
        cx="7"
        cy="7"
        r={r}
        className={cn('[stroke-linecap:round]', className)}
        strokeDasharray={`${(percent / 100) * c} ${c}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  )
}

/** Everything known about one provider's limits. The age only shows once it is stale, since providers only report while they run. */
function UsageDetail({
  provider,
  five,
  weekly,
  scoped,
  others,
}: ReturnType<typeof byProvider>[number] & { others: { id: string; name: string; peak: UsageReading | undefined }[] }) {
  useLanguage()
  const all = [five, weekly, ...scoped].filter((r): r is UsageReading => !!r)
  const newest = Math.max(...all.map((r) => r.updatedAt))
  const plan = all.find((r) => r.plan)?.plan
  return (
    <section className="flex flex-col gap-2.5">
      <header className="flex items-center gap-[7px] text-control">
        <ProviderIcon provider={provider} size={15} />
        <strong className="font-semibold">{providerName(provider)}</strong>
        {plan && (
          <Badge
            variant="secondary"
            className="ml-auto h-auto rounded-(--radius-s) bg-fill px-[7px] py-0.5 text-caption font-normal text-muted-foreground"
          >
            {plan}
          </Badge>
        )}
      </header>
      {all.map((reading) => {
        const tone = usageTone(reading),
          reset = resetText(reading.resetsAt)
        return (
          <div key={`${reading.window}:${reading.scope ?? ''}`} className="flex flex-col gap-1.5">
            <div className="flex justify-between gap-2 text-control">
              <span>{windowLabel(reading)}</span>
              <span className={cn('tabular-nums', toneText[tone])}>
                {reading.status === 'limited' ? t('Limit reached') : t('{0}% used', { '0': reading.usedPercent })}
              </span>
            </div>
            <Progress
              value={Math.max(0, Math.min(100, reading.usedPercent))}
              aria-label={windowLabel(reading)}
              className={cn(
                '[&_[data-slot=progress-track]]:h-1.5 [&_[data-slot=progress-track]]:bg-foreground/10 [&_[data-slot=progress-indicator]]:rounded-full',
                toneFill[tone],
              )}
            />
            {reset && <span className="text-caption text-muted-foreground">{reset}</span>}
          </div>
        )
      })}
      {others.length > 0 && (
        <div
          className="flex flex-col gap-1 border-t border-line pt-2"
          aria-label={t('Other {0} accounts', { '0': providerName(provider) })}
        >
          <span className="text-caption text-muted-foreground">
            {t('Other accounts, used when this one is at its limit')}
          </span>
          {others.map(({ id, name, peak }) => {
            const tone = peak ? usageTone(peak) : 'ok',
              reset = peak?.status === 'limited' ? resetText(peak.resetsAt) : null
            return (
              <div key={id} className="flex justify-between gap-2 text-control">
                <span className="min-w-0 truncate">{name}</span>
                <span className={cn('flex-none tabular-nums', toneText[tone])} title={reset ?? undefined}>
                  {!peak
                    ? t('No data yet')
                    : peak.status === 'limited'
                      ? t('Limit reached')
                      : t('{0}% used', { '0': peak.usedPercent })}
                </span>
              </div>
            )
          })}
        </div>
      )}
      {Date.now() - newest > STALE_MS && (
        <span className="text-caption text-warn">
          {t('Updated')} {ageText(newest)}
          {t(' · refreshes when this provider next runs')}
        </span>
      )}
    </section>
  )
}

function UsagePopover({
  trigger,
  side = 'top',
  align = 'start',
}: {
  trigger: React.ReactElement
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
}) {
  useLanguage()
  const groups = byProvider(useVisibleUsage())
  const { preferences } = useAppSettings()
  const [open, setOpen] = useState(false)
  const rotating = groups.some(
    ({ provider }) => providerAccountOrder(preferences.providerBinaries, provider).length > 1,
  )
  const accountReadings = useAccountUsage(open && rotating)
  const othersOf = (provider: AgentProvider) => {
    const config = preferences.providerBinaries[provider]
    const order = providerAccountOrder(preferences.providerBinaries, provider)
    return order
      .filter((id) => id !== (config?.accountId || 'default'))
      .map((id) => ({
        id,
        name: accountLabel(config, id),
        peak: peakUsage(
          accountReadings.filter((reading) => (reading.accountId ?? 'default') === id),
          provider,
        ),
      }))
  }
  // Hover peeks; a click on the trigger while peeking pins it open instead of closing it.
  const peeking = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
    },
    [],
  )
  const peek = (next: boolean) => {
    peeking.current = next
    setOpen(next)
  }
  const enter = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch' || open) return
    clearTimer()
    timer.current = setTimeout(() => peek(true), 150)
  }
  const leave = (event: React.PointerEvent) => {
    if (event.pointerType === 'touch' || (!peeking.current && open)) return
    clearTimer()
    timer.current = setTimeout(() => peek(false), 200)
  }
  const change = (next: boolean, details: { reason: string }) => {
    clearTimer()
    if (!next && peeking.current && details.reason === 'trigger-press') {
      peeking.current = false
      return
    }
    peeking.current = false
    setOpen(next)
  }
  return (
    <Popover open={open} onOpenChange={change}>
      <PopoverTrigger
        render={trigger}
        onPointerEnter={enter}
        onPointerLeave={leave}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) {
            clearTimer()
            peek(true)
          }
        }}
      />
      <PopoverContent
        side={side}
        align={align}
        sideOffset={6}
        className="usage-popover w-[280px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-32px)] overflow-y-auto gap-3.5 p-3.5 rounded-(--radius-m) border border-edge bg-card text-foreground ring-0 shadow-(--shadow-float)"
        aria-label={t('Plan usage')}
        initialFocus={false}
        onPointerEnter={clearTimer}
        onPointerLeave={leave}
      >
        <div className="flex items-center gap-1.5 text-caption text-muted-foreground">
          <Gauge size={14} />
          <span>{t('Plan usage')}</span>
        </div>
        {groups.map((group, index) => (
          <Fragment key={group.provider}>
            {index > 0 && <Separator className="h-px bg-line" />}
            <UsageDetail {...group} others={othersOf(group.provider)} />
          </Fragment>
        ))}
        <Separator className="h-px bg-line" />
        <p className="m-0 text-caption leading-normal whitespace-normal text-muted-foreground">
          {t('Fallback continues the chat when a usage limit is reached.')}
        </p>
      </PopoverContent>
    </Popover>
  )
}

/** Pinned to the bottom of the sidebar: one line with each provider's highest window, so it never squeezes the chat list. The window is named once it needs attention; everything else is in the popover. */
export function UsageFooter() {
  useLanguage()
  const { preferences } = useAppSettings()
  const all = useVisibleUsage()
  const groups = byProvider(all)
  if (!preferences.showUsageLimits || !groups.length) return null
  const label = groups
    .map(
      ({ provider, five, weekly }) =>
        `${providerName(provider)}: ${[five && `5-hour ${five.usedPercent}%`, weekly && `${weekly.window === 'monthly' ? 'monthly' : 'weekly'} ${weekly.usedPercent}%`].filter(Boolean).join(', ')}`,
    )
    .join('; ')
  return (
    <div className="usage-footer flex flex-none items-center">
      <UsagePopover
        trigger={
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-h-8 min-w-0 w-full flex-1 flex-wrap justify-start gap-x-3 gap-y-1 rounded-(--radius-row) bg-fill px-2.5 py-[5px] text-[length:var(--font-caption)] leading-4 font-normal text-soft [transition:background-color_140ms_ease,color_140ms_ease] hover:bg-hover hover:text-foreground dark:bg-fill dark:hover:bg-hover aria-expanded:bg-hover aria-expanded:text-foreground active:not-aria-[haspopup]:translate-y-0"
            aria-label={t('Plan usage. {0}', { '0': label })}
          >
            <Gauge className="size-[calc(var(--font-caption)+3px)] text-muted-foreground" />
            {groups.map(({ provider }) => {
              const peak = peakUsage(all, provider)!,
                tone = usageTone(peak)
              return (
                <span key={provider} className="usage-compact-item inline-flex items-center gap-1">
                  <ProviderIcon provider={provider} size="calc(var(--font-caption) + 2px)" />
                  <span className={cn('text-[length:var(--font-caption)] leading-4 tabular-nums', toneText[tone])}>
                    {peak.usedPercent}%
                  </span>
                  {tone !== 'ok' && (
                    <span className="usage-window-label -ml-px text-[length:calc(var(--font-caption)-2px)] leading-3.5 text-muted-foreground">
                      {windowLabel(peak, true)}
                    </span>
                  )}
                </span>
              )
            })}
          </Button>
        }
      />
    </div>
  )
}

/** With the sidebar hidden: one small ring per provider at the end of the status bar. */
export function UsageRings() {
  useLanguage()
  const { preferences } = useAppSettings()
  const all = useVisibleUsage()
  const groups = byProvider(all)
  if (!preferences.showUsageLimits || !groups.length) return null
  return (
    <UsagePopover
      side="top"
      align="end"
      trigger={
        <Button
          type="button"
          variant="ghost"
          className="usage-rings h-[22px] gap-1 px-1.5 hover:bg-hover dark:hover:bg-hover aria-expanded:bg-hover active:not-aria-[haspopup]:translate-y-0"
          aria-label={t('Plan usage')}
        >
          {groups.map(({ provider }) => {
            const peak = peakUsage(all, provider)!
            return (
              <span
                key={provider}
                className="inline-flex"
                title={`${providerName(provider)} ${windowLabel(peak)} ${peak.usedPercent}%`}
              >
                <Ring percent={peak.usedPercent} className={toneStroke[usageTone(peak)]} />
              </span>
            )
          })}
        </Button>
      }
    />
  )
}

/** How full the chat's context window is: a small ring and percentage in the composer. Claude and Codex both report it. */
export function ContextMeter({ sessionId }: { sessionId: string }) {
  useLanguage()
  const [context, setContext] = useState<ContextUsage | null>(null)
  useEffect(() => {
    let cancelled = false
    setContext(null)
    void invoke('agent.context', sessionId).then(
      (value) => {
        if (!cancelled) setContext(value)
      },
      () => {},
    )
    const off = ramu.on('context:changed', (event) => {
      if (event.sessionId === sessionId) setContext(event.context)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [sessionId])
  if (!context) return null
  const tone: UsageTone = context.percent >= 95 ? 'bad' : context.percent >= 80 ? 'warn' : 'ok'
  const k = (n: number) => (n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`)
  return (
    <span
      className={cn(
        'ml-0.5 inline-flex cursor-default items-center gap-[5px] px-1 text-caption tabular-nums',
        tone === 'ok' ? 'text-muted-foreground' : toneText[tone],
      )}
      role="img"
      aria-label={t('Context {0}% full', { '0': context.percent })}
      title={t('Context window: {0} of {1} tokens used{2}', {
        '0': k(context.used),
        '1': k(context.max),
        '2': tone === 'ok' ? '' : t('. Compaction happens automatically when it fills.'),
      })}
    >
      <Ring percent={context.percent} className={tone === 'ok' ? 'stroke-soft' : toneStroke[tone]} />
      <span>{context.percent}%</span>
    </span>
  )
}

/** Estimates apply only to Ramu output views; billing still comes from providers. */
export function CompressionMeter({ sessionId }: { sessionId: string }) {
  const [stats, setStats] = useState<{ estimatedTokensAvoided: number; note: string } | null>(null)
  useEffect(() => {
    let disposed = false
    const refresh = () => {
      void invoke('agent.compression', sessionId).then(
        (value) => {
          if (!disposed) setStats(value)
        },
        () => {},
      )
    }
    refresh()
    const off = ramu.on('agent:event', (event) => {
      if (event.sessionId === sessionId && event.event.kind === 'result') refresh()
    })
    return () => {
      disposed = true
      off()
    }
  }, [sessionId])
  return stats && stats.estimatedTokensAvoided > 0 ? (
    <span className="text-caption text-muted-foreground" title={stats.note}>
      {t('~{0} tokens avoided', { 0: stats.estimatedTokensAvoided.toLocaleString() })}
    </span>
  ) : null
}
