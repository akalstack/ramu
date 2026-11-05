import {
  activityAcrossHosts,
  loginsAcrossHosts,
  peakOf,
  type ActivityTotal,
  type HostUsage,
  type LoginUsage,
} from '@ramu/shared/usageAcrossHosts'
import { useComputers } from '../workspace/computers'
import { usageTone, usagePercent, usageScopeHint } from '@ramu/shared/usage/presentation'
export { usageTone } from '@ramu/shared/usage/presentation'
import { t, useLanguage, formatLocale } from '../i18n'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { cn } from 'cn'
import { Eye, EyeOff, Gauge } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AgentProvider, ContextUsage, UsageReading } from '@ramu/shared/types'
import {
  accountName,
  providerEnabled,
  providerName,
  type AccountLogin,
  type ProviderConfiguration,
} from '@ramu/shared/providers/providers'
import { bridge, invokeOn, invokerFor } from '../ipc'
import { ownHostId } from '../hosts'
import { deviceStorage } from '../deviceStorage'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { ProviderIcon } from '../models/ProviderIcon'
import { useAppSettings } from './AppSettings'
import { workspaceVisible, onWorkspaceVisibility } from '../workspace/workspaceLifetime'

// One shared usage subscription per host; provider logins and reset times belong to that host.
const usageStores = new Map<string, ReturnType<typeof createUsageStore>>()
function createUsageStore(host: string) {
  let readings: UsageReading[] = []
  const listeners = new Set<() => void>()
  let stop: (() => void) | undefined
  const invoke = invokerFor(host)
  const publish = (next: UsageReading[]) => {
    readings = next
    listeners.forEach((listener) => listener())
  }
  return {
    snapshot: () => readings,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        let disposed = false
        let refreshing = false
        const accept = (next: UsageReading[]) => {
          if (!disposed) publish(next)
        }
        const refresh = () => {
          if (!workspaceVisible() || document.visibilityState !== 'visible' || refreshing) return
          refreshing = true
          void invoke('usage.refresh')
            .then(accept, () => {})
            .finally(() => {
              refreshing = false
            })
        }
        void invoke('usage.get').then(accept, () => {})
        refresh()
        const offUsage = bridge.on('usage:changed', (next, from) => {
          if ((from ?? ownHostId()) === host) accept(next)
        })
        const offConnection = bridge.on('background:connection', ({ connected }, from) => {
          if (connected && (from ?? ownHostId()) === host) refresh()
        })
        const offVisibility = onWorkspaceVisibility(refresh)
        const timer = window.setInterval(refresh, 5 * 60_000 + 5_000)
        window.addEventListener('focus', refresh)
        document.addEventListener('visibilitychange', refresh)
        stop = () => {
          disposed = true
          offUsage()
          offConnection()
          offVisibility()
          window.clearInterval(timer)
          window.removeEventListener('focus', refresh)
          document.removeEventListener('visibilitychange', refresh)
        }
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) stop?.()
      }
    },
  }
}
export function useUsage(): UsageReading[] {
  useLanguage()
  const host = useHost().id
  let store = usageStores.get(host)
  if (!store) {
    store = createUsageStore(host)
    usageStores.set(host, store)
  }
  return useSyncExternalStore(store.subscribe, store.snapshot)
}

/** Readings for every login of every provider; the shared copy above only holds the selected one. Reloads when usage changes. */
export function useAccountUsage(enabled = true): UsageReading[] {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
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
    const off = on('usage:changed', load)
    return () => {
      cancelled = true
      off()
    }
  }, [enabled, invoke, on])
  return all
}

/**
 * Each login's sign-in email and whether it uses an API key, loaded while `enabled`, for naming logins without a label.
 * Read again when a login is signed in or given a key, or the list of logins changes, so every picker names it at once.
 */
export function useAccountLogins(enabled = true): Record<string, Record<string, AccountLogin>> {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const [logins, setLogins] = useState<Record<string, Record<string, AccountLogin>>>({})
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = () =>
      void invoke('providers.accountLogins').then(
        (next) => {
          if (!cancelled) setLogins(next)
        },
        () => {},
      )
    load()
    const offLogins = on('logins:changed', load)
    const offSettings = on('settings:changed', load)
    return () => {
      cancelled = true
      offLogins()
      offSettings()
    }
  }, [enabled, invoke, on])
  return logins
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1)

/** Readings older than this are shown with their age; providers only report while they run. */
const STALE_MS = 10 * 60_000

export type UsageTone = 'ok' | 'warn' | 'bad'
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
    const five = own.find((r) => r.window === 'five_hour' && !r.scope)
    const weekly = own.find((r) => (r.window === 'weekly' || r.window === 'monthly') && !r.scope)
    return [
      {
        provider,
        five,
        weekly,
        scoped: own.filter((r) => r !== five && r !== weekly),
      },
    ]
  })
}

/** The highest window for a provider, which decides warnings and fallback. */
export function peakUsage(all: UsageReading[], provider: AgentProvider): UsageReading | undefined {
  return all.filter((reading) => reading.provider === provider).sort((a, b) => b.usedPercent - a.usedPercent)[0]
}

/** Cursor's headline number is the two allowances combined, not a third quota. */
const isCursorOverall = (reading: UsageReading) =>
  reading.provider === 'cursor' && reading.window === 'monthly' && !reading.scope

/** What a window means, for the providers whose windows are not obvious from their name. */
export function usageHint(reading: UsageReading): string | undefined {
  const hint = usageScopeHint(reading)
  return hint ? t(hint) : undefined
}

export function windowLabel(reading: UsageReading, short = false): string {
  if (isCursorOverall(reading)) return t('Overall')
  const base =
    reading.window === 'five_hour'
      ? short
        ? t('5h')
        : t('5-hour')
      : reading.window === 'monthly'
        ? short
          ? t('mo')
          : t('Monthly')
        : reading.window === 'quota'
          ? t('Quota')
          : short
            ? t('wk')
            : t('Weekly')
  return reading.scope ? `${reading.scope} ${short ? base : base.toLowerCase()}` : base
}

export function resetText(at: number | undefined, now = Date.now()): string | null {
  if (!at) return null
  const ms = at - now
  if (ms <= 0) return t('Reset time passed; awaiting update')
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

function usageStatusText(reading: UsageReading): string {
  return reading.source === 'notice'
    ? t('Limit reported; usage unavailable')
    : usagePercent(reading) === null
      ? t('Not reported')
      : reading.status === 'limited'
        ? t('Limit reached')
        : t('{0}% used', { '0': usagePercent(reading)! })
}

function UsageBar({ reading, tone }: { reading: UsageReading; tone: UsageTone }) {
  return (
    <Progress
      value={usagePercent(reading)!}
      aria-label={windowLabel(reading)}
      className={cn(
        '[&_[data-slot=progress-track]]:h-1 [&_[data-slot=progress-track]]:bg-foreground/10 [&_[data-slot=progress-indicator]]:rounded-full',
        toneFill[tone],
      )}
    />
  )
}

/** One limit window of a login: its name and how much is used, a bar, and when it resets. */
function WindowMeter({ reading }: { reading: UsageReading }) {
  const tone = usageTone(reading),
    reset = resetText(reading.resetsAt)
  return (
    <div className="flex min-w-0 flex-col gap-1" title={usageHint(reading)}>
      <div className="flex items-baseline justify-between gap-2 text-caption">
        <span className="truncate text-muted-foreground">{windowLabel(reading)}</span>
        <span className={cn('flex-none tabular-nums', toneText[tone])}>{usageStatusText(reading)}</span>
      </div>
      {usagePercent(reading) !== null && <UsageBar reading={reading} tone={tone} />}
      {reset && <span className="truncate text-[11px] leading-4 text-muted-foreground">{reset}</span>}
    </div>
  )
}

/** Windows in reading order: the short window, then the weekly or monthly allowance, then model-specific ones. */
const windowOrder = (reading: UsageReading) =>
  (reading.scope ? 2 : 0) + (reading.window === 'five_hour' ? 0 : reading.window === 'quota' ? 1.5 : 1)

const REVEAL_KEY = 'ramu.usage.accounts'

type HostLogins = HostUsage & {
  config: ProviderConfiguration | undefined
  logins: Record<string, Record<string, AccountLogin>>
}

/** Every connected host's logins and readings, read while the dialog is open. */
function useHostLogins(open: boolean): HostLogins[] | null {
  const computers = useComputers()
  const [hosts, setHosts] = useState<HostLogins[] | null>(null)
  const list = (computers?.computers ?? []).filter((computer) => computer.status === 'connected')
  const key = list.map((computer) => computer.id).join(',')
  useEffect(() => {
    if (!open) return
    let live = true
    const load = () =>
      void Promise.all(
        list.map(async (computer) => {
          const [readings, emails, logins, settings] = await Promise.all([
            invokeOn(computer.id, 'usage.accounts').catch(() => [] as UsageReading[]),
            invokeOn(computer.id, 'providers.accountEmails').catch(() => ({})),
            invokeOn(computer.id, 'providers.accountLogins').catch(() => ({})),
            invokeOn(computer.id, 'settings.app.get').catch(() => null),
          ])
          return {
            hostId: computer.id,
            host: computer.name,
            readings,
            emails,
            logins,
            config: settings?.providerBinaries,
          }
        }),
      ).then((next) => live && setHosts(next))
    load()
    const off = bridge.on('usage:changed', load)
    return () => {
      live = false
      off()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the connected host ids
  }, [open, key])
  return hosts
}

/** One login seen across hosts, named and marked for the dialog. */
type LoginRow = LoginUsage & {
  name: string
  /** In use on this host. */
  inUse: boolean
  /** Every host it is signed in on, and whether that host's threads use it. */
  where: { host: string; inUse: boolean }[]
  plan?: string
  newest: number
}

/**
 * Every login of one provider: the one this host uses first, then the ones with the most room. A login signed in on
 * several hosts shows once with every host named, since its quota is the same wherever it runs.
 */
function ProviderLogins({
  provider,
  rows,
  multiHost,
}: {
  provider: AgentProvider
  rows: LoginRow[]
  multiHost: boolean
}) {
  useLanguage()
  const withRoom = rows.filter((row) => {
    const peak = peakOf(row)
    return !peak || (peak.status !== 'limited' && peak.usedPercent < 100)
  }).length
  return (
    <section className="flex flex-col gap-2" aria-label={providerName(provider)}>
      <header className="flex items-center gap-2">
        <ProviderIcon provider={provider} size={16} />
        <h3 className="m-0 text-control font-semibold">{providerName(provider)}</h3>
        {rows.length > 1 && (
          <span className="ml-auto text-caption text-muted-foreground">
            {t('{0} logins · {1} with room', { 0: rows.length, 1: withRoom })}
          </span>
        )}
      </header>
      <div className="flex flex-col overflow-hidden rounded-(--radius-m) bg-fill">
        {rows.map((row, index) => {
          const readings = [...row.readings].sort((a, b) => windowOrder(a) - windowOrder(b))
          return (
            <div
              key={`${row.email ?? ''}:${row.places.map((place) => `${place.hostId}/${place.accountId}`).join(',')}`}
              className={cn(
                'grid items-start gap-x-6 gap-y-2.5 px-3.5 py-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]',
                index > 0 && 'border-t border-line',
              )}
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="truncate text-control" title={row.name}>
                  {row.name}
                </span>
                {(row.inUse || row.plan) && (
                  <span className="flex flex-wrap items-center gap-1">
                    {row.inUse && (
                      <Badge
                        variant="secondary"
                        className="h-auto rounded-(--radius-s) bg-brand/15 px-1.5 py-0 text-caption font-normal text-brand"
                      >
                        {t('In use')}
                      </Badge>
                    )}
                    {row.plan && (
                      <Badge
                        variant="secondary"
                        className="h-auto rounded-(--radius-s) bg-hover px-1.5 py-0 text-caption font-normal text-muted-foreground"
                      >
                        {capitalize(row.plan)}
                      </Badge>
                    )}
                  </span>
                )}
                {multiHost &&
                  row.where.map((place) => (
                    <span
                      key={place.host}
                      className="flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground"
                      title={place.inUse ? t('Threads on {0} use this login', { 0: place.host }) : undefined}
                    >
                      <span
                        aria-hidden
                        className={cn('size-1.5 flex-none rounded-full', place.inUse ? 'bg-brand' : 'bg-foreground/25')}
                      />
                      <span className="truncate">
                        {place.inUse ? t('{0} · in use', { 0: place.host }) : place.host}
                      </span>
                    </span>
                  ))}
                {row.matchedBy === 'limits' && (
                  <span
                    className="text-caption text-muted-foreground"
                    title={t(
                      'No sign-in email on some hosts; matched because its limits and reset times are identical.',
                    )}
                  >
                    {t('Matched by its limits')}
                  </span>
                )}
                {readings.length > 0 && Date.now() - row.newest > STALE_MS && (
                  <span className="text-caption text-warn" title={t('Refreshes when this provider next runs.')}>
                    {t('Updated')} {ageText(row.newest)}
                  </span>
                )}
              </div>
              {readings.length ? (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-4 gap-y-3">
                  {readings.map((reading) => (
                    <WindowMeter key={`${reading.window}:${reading.scope ?? ''}`} reading={reading} />
                  ))}
                </div>
              ) : (
                <span className="self-center text-caption text-muted-foreground">
                  {t('No reading yet. It appears after this login next runs.')}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/**
 * Plan usage for every login on every connected host, opened from the sidebar meter: one section per provider, one
 * row per login with all its windows, the login this host uses marked, and the week's activity.
 */
function UsageDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  useLanguage()
  const host = useHost()
  const { preferences } = useAppSettings()
  const hosts = useHostLogins(open)
  // Labels and emails stay hidden until asked for, since the dialog may be open while sharing a screen.
  const [reveal, setReveal] = useState(() => deviceStorage.getItem(REVEAL_KEY) === 'shown')
  const toggleReveal = () => {
    deviceStorage.setItem(REVEAL_KEY, reveal ? 'hidden' : 'shown')
    setReveal(!reveal)
  }
  const multiHost = (hosts?.length ?? 0) > 1
  const logins = hosts ? loginsAcrossHosts(hosts) : []
  const sections = ORDER.flatMap((provider) => {
    if (!providerEnabled(preferences.providerBinaries, provider)) return []
    const rows: LoginRow[] = logins
      .filter((login) => login.provider === provider)
      .map((login) => {
        // Named by this host's own label when it is signed in here, otherwise by email or where it is signed in.
        const here = login.places.find((place) => place.hostId === host.id)
        const place = here ?? login.places[0]!
        const source = hosts!.find((entry) => entry.hostId === place.hostId)
        const name = accountName(
          source?.config,
          provider,
          place.accountId,
          source?.logins[provider]?.[place.accountId],
          t,
          reveal,
        )
        const active = here && (preferences.providerBinaries[provider]?.accountId || 'default') === here.accountId
        const where = hosts!
          .filter((entry) => login.places.some((place) => place.hostId === entry.hostId))
          .map((entry) => ({
            host: entry.hostId === host.id ? t('This host') : entry.host,
            inUse: login.places.some(
              (place) =>
                place.hostId === entry.hostId &&
                ((entry.hostId === host.id
                  ? preferences.providerBinaries[provider]?.accountId
                  : entry.config?.[provider]?.accountId) || 'default') === place.accountId,
            ),
          }))
        const newest = Math.max(...login.readings.map((reading) => reading.updatedAt))
        const plan = [...login.readings].filter((r) => r.plan).sort((a, b) => b.updatedAt - a.updatedAt)[0]?.plan
        return {
          ...login,
          name,
          inUse: !!active,
          where,
          ...(plan ? { plan } : {}),
          newest,
        }
      })
      .sort(
        (a, b) =>
          Number(b.inUse) - Number(a.inUse) ||
          Number(b.where.some((place) => place.inUse)) - Number(a.where.some((place) => place.inUse)) ||
          (peakOf(a)?.usedPercent ?? 0) - (peakOf(b)?.usedPercent ?? 0),
      )
    return rows.length ? [{ provider, rows }] : []
  })
  const openFallback = () => {
    onOpenChange(false)
    window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'models' } }))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(86vh,820px)] flex-col gap-0 p-0 sm:max-w-[680px]">
        <DialogHeader className="flex-none flex-row items-center gap-3 border-b border-line px-5 py-3.5 pr-12">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Gauge size={16} className="text-muted-foreground" />
              {t('Plan usage')}
            </DialogTitle>
            <DialogDescription className="text-caption">
              {multiHost
                ? t('Every login on every connected host. A login signed in on several hosts shows once.')
                : t('Every login on this host. Fallback moves a thread to the next one when a limit is reached.')}
            </DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="flex-none text-muted-foreground"
            aria-pressed={reveal}
            title={reveal ? t('Hide account names and emails') : t('Show account names and emails')}
            onClick={toggleReveal}
          >
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            {reveal ? t('Hide accounts') : t('Show accounts')}
          </Button>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto scroll-fade-y px-5 pt-4 pb-5">
          {!hosts ? (
            <p className="m-0 text-caption text-muted-foreground" role="status">
              {t('Reading usage…')}
            </p>
          ) : sections.length ? (
            sections.map((section) => <ProviderLogins key={section.provider} {...section} multiHost={multiHost} />)
          ) : (
            <p className="m-0 text-caption text-muted-foreground">
              {t('No usage reported yet. It appears once a provider runs.')}
            </p>
          )}
          <WeekActivity />
        </div>
        <footer className="flex flex-none items-center gap-2 border-t border-line px-5 py-2.5 text-caption text-muted-foreground">
          <span className="min-w-0 flex-1">{t('Fallback continues the thread when a usage limit is reached.')}</span>
          <Button variant="ghost" size="sm" className="flex-none" onClick={openFallback}>
            {t('Fallback settings')}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}

/** This week's finished turns, reported cost and tokens, added across connected hosts; a host not read is named, not zero. */
function WeekActivity() {
  const computers = useComputers()
  const [total, setTotal] = useState<ActivityTotal | null>(null)
  const hosts = (computers?.computers ?? []).filter((computer) => computer.status !== 'rejected')
  const key = hosts.map((computer) => `${computer.id}:${computer.status}`).join(',')
  useEffect(() => {
    let live = true
    void Promise.all(
      hosts.map(async (computer) => ({
        host: computer.name,
        rows:
          computer.status === 'connected' ? await invokeOn(computer.id, 'usage.activity', 7).catch(() => null) : null,
      })),
    ).then((rows) => live && setTotal(activityAcrossHosts(rows)))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on hosts and their connection state
  }, [key])
  if (!total || !total.turns) return null
  const money =
    total.costUsd > 0
      ? ` · ${new Intl.NumberFormat(formatLocale(), { style: 'currency', currency: 'USD' }).format(total.costUsd)}`
      : ''
  const tokens =
    total.tokens > 0
      ? ` · ${t('{0} tokens', {
          0: new Intl.NumberFormat(formatLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(
            total.tokens,
          ),
        })}`
      : ''
  const notes = [
    total.unpricedOn.length > 0 && t('Some providers on {0} report no cost', { 0: total.unpricedOn.join(', ') }),
    total.tokens > 0 &&
      total.untokenedOn.length > 0 &&
      t('Some providers on {0} report no tokens', { 0: total.untokenedOn.join(', ') }),
    total.missing.length > 0 && t('Not counted: {0}', { 0: total.missing.join(', ') }),
  ].filter(Boolean)
  return (
    <section className="flex flex-col gap-1.5" aria-label={t('This week')}>
      <h3 className="m-0 text-control font-semibold">{t('This week')}</h3>
      <div className="flex flex-col gap-1 rounded-(--radius-m) bg-fill px-3 py-2.5">
        <p className="m-0 text-control">
          {t('{0} turns', { 0: total.turns })}
          {money}
          {tokens}
          {total.byHost.length > 1 && ` · ${total.byHost.map((entry) => `${entry.host} ${entry.turns}`).join(', ')}`}
        </p>
        {notes.length > 0 && <p className="m-0 text-caption text-muted-foreground">{notes.join(' · ')}</p>}
      </div>
    </section>
  )
}

/** How soon a limited window comes back, as short as the footer allows: `45m`, `3h`, `2d`. */
function backIn(at: number | undefined, now = Date.now()): string | null {
  if (!at || at <= now) return null
  const minutes = Math.max(1, Math.round((at - now) / 60_000))
  return minutes < 60
    ? `${minutes}m`
    : minutes < 2880
      ? `${Math.round(minutes / 60)}h`
      : `${Math.round(minutes / 1440)}d`
}
const toneBar: Record<UsageTone, string> = { ok: 'bg-brand', warn: 'bg-warn', bad: 'bg-bad' }

/**
 * Plan usage pinned to the foot of the sidebar, for the login in use: one cell per provider, two to a row, in the
 * app's provider order. Each shows the provider's fullest window as a bar and a whole percentage; a provider at its limit shows when
 * it comes back instead. A click opens every login in Plan usage.
 */
export function UsageFooter() {
  useLanguage()
  const { preferences } = useAppSettings()
  const all = useVisibleUsage()
  // In the same provider order everywhere (Claude, Codex, …), so each one stays in its place as usage changes.
  const groups = byProvider(all).map((group) => ({ ...group, peak: peakUsage(all, group.provider)! }))
  const [open, setOpen] = useState(false)
  if (!preferences.showUsageLimits || !groups.length) return null
  const label = groups
    .map(({ provider, peak }) => `${providerName(provider)}: ${windowLabel(peak)} ${usageStatusText(peak)}`)
    .join('; ')
  return (
    <div className="usage-footer flex flex-none items-center">
      <Button
        type="button"
        variant="ghost"
        className={cn(
          'grid h-auto min-h-8 w-full min-w-0 gap-x-3 gap-y-1 rounded-(--radius-row) bg-fill px-2.5 py-1.5 text-[length:var(--font-caption)] leading-4 font-normal text-soft [transition:background-color_140ms_ease,color_140ms_ease] hover:bg-hover hover:text-foreground dark:bg-fill dark:hover:bg-hover aria-expanded:bg-hover active:not-aria-[haspopup]:translate-y-0',
          groups.length > 1 ? 'grid-cols-2' : 'grid-cols-1',
        )}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t('Plan usage. {0}', { '0': label })}
        title={t('Plan usage')}
        onClick={() => setOpen(true)}
      >
        {groups.map(({ provider, peak }) => {
          const tone = usageTone(peak)
          const percent = usagePercent(peak)
          const back = peak.status === 'limited' ? backIn(peak.resetsAt) : null
          return (
            <span
              key={provider}
              className="flex min-w-0 items-center gap-1.5"
              title={[providerName(provider), windowLabel(peak), usageStatusText(peak), resetText(peak.resetsAt)]
                .filter(Boolean)
                .join(' · ')}
            >
              <ProviderIcon provider={provider} size="calc(var(--font-caption) + 1px)" />
              <span className="relative h-1 min-w-3 flex-1 overflow-hidden rounded-full bg-foreground/10">
                <span
                  className={cn('absolute inset-y-0 left-0 rounded-full', toneBar[tone])}
                  style={{ width: `${percent ?? (peak.status === 'limited' ? 100 : 0)}%` }}
                />
              </span>
              <span className={cn('flex-none text-right tabular-nums', toneText[tone])}>
                {back ??
                  (percent === null ? (peak.status === 'limited' ? t('Limited') : '–') : `${Math.round(percent)}%`)}
              </span>
            </span>
          )
        })}
      </Button>
      <UsageDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}

/** With the sidebar hidden: one small ring per provider at the end of the status bar, opening Plan usage. */
export function UsageRings() {
  useLanguage()
  const { preferences } = useAppSettings()
  const all = useVisibleUsage()
  const groups = byProvider(all)
  const [open, setOpen] = useState(false)
  if (!preferences.showUsageLimits || !groups.length) return null
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        className="usage-rings h-[22px] gap-1 px-1.5 hover:bg-hover dark:hover:bg-hover aria-expanded:bg-hover active:not-aria-[haspopup]:translate-y-0"
        aria-label={t('Plan usage')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
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
      <UsageDialog open={open} onOpenChange={setOpen} />
    </>
  )
}

/** How full the chat's context window is: a small ring and percentage in the composer. Claude and Codex both report it. */
export function ContextMeter({ sessionId }: { sessionId: string }) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
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
    const off = on('context:changed', (event) => {
      if (event.sessionId === sessionId) setContext(event.context)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [sessionId, invoke, on])
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
      aria-label={t('Context {0}% full, {1} of {2} tokens used', {
        '0': context.percent,
        '1': context.used.toLocaleString(),
        '2': context.max.toLocaleString(),
      })}
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
