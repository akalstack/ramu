import { t, useLanguage, formatLocale } from './i18n'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { ChevronUp, Gauge } from 'lucide-react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { AgentProvider, ContextUsage, UsageReading } from '../../shared/types'
import { providerName } from '../../shared/providers'
import { invoke, ramu } from './ipc'
import { ProviderIcon } from './ProviderIcon'
import { useAppSettings } from './AppSettings'

// One shared copy of the account's plan usage; the main process pushes every change.
let readings: UsageReading[] = []
let started = false
const listeners = new Set<() => void>()
const publish = (next: UsageReading[]) => { readings = next; listeners.forEach((listener) => listener()) }
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (!started) {
    started = true
    void invoke('usage.get').then(publish, () => {})
    // Claude's usage can be read without a turn, so the gauges are right on open.
    void invoke('usage.refresh').then(publish, () => {})
    ramu.on('usage:changed', publish)
    ramu.on('background:connection', ({ connected }) => { if (connected) void invoke('usage.get').then(publish, () => {}) })
  }
  return () => { listeners.delete(listener) }
}
export function useUsage(): UsageReading[] {
  const language = useLanguage()
 return useSyncExternalStore(subscribe, () => readings) }

/** Readings older than this are shown with their age; providers only report while they run. */
const STALE_MS = 10 * 60_000

export type UsageTone = 'ok' | 'warn' | 'bad'
export function usageTone(reading: Pick<UsageReading, 'usedPercent' | 'status'>): UsageTone {
  return reading.status === 'limited' || reading.usedPercent >= 90 ? 'bad' : reading.usedPercent >= 70 ? 'warn' : 'ok'
}

/** Provider order on screen: the two subscription providers first. */
const ORDER: AgentProvider[] = ['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']
function byProvider(all: UsageReading[]): { provider: AgentProvider; five?: UsageReading; weekly?: UsageReading; scoped: UsageReading[] }[] {
  return ORDER.flatMap((provider) => {
    const own = all.filter((reading) => reading.provider === provider)
    if (!own.length) return []
    return [{ provider, five: own.find((r) => r.window === 'five_hour' && !r.scope), weekly: own.find((r) => r.window === 'weekly' && !r.scope), scoped: own.filter((r) => r.scope) }]
  })
}

/** The highest window for a provider, which decides warnings and fallback. */
export function peakUsage(all: UsageReading[], provider: AgentProvider): UsageReading | undefined {
  return all.filter((reading) => reading.provider === provider).sort((a, b) => b.usedPercent - a.usedPercent)[0]
}

export function windowLabel(reading: UsageReading, short = false): string {
  const base = reading.window === 'five_hour' ? (short ? t('5h') : t('5-hour')) : (short ? t('wk') : t('Weekly'))
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
  return t('resets {date}', { date: new Date(at).toLocaleString(formatLocale(), { weekday: 'short', hour: '2-digit', minute: '2-digit' }) })
}

function ageText(at: number, now = Date.now()): string {
  const minutes = Math.round((now - at) / 60_000)
  return minutes < 1 ? t('just now') : minutes < 60 ? t('{minutes} min ago', { minutes }) : minutes < 1440 ? t('{hours} h ago', { hours: Math.round(minutes / 60) }) : new Date(at).toLocaleDateString(formatLocale())
}

function Bar({ reading, size = 'small' }: { reading?: UsageReading; size?: 'small' | 'large' }) {
  useLanguage()
  const percent = reading?.usedPercent ?? 0
  return <span className={`usage-bar ${size} ${reading ? usageTone(reading) : 'unknown'}`} role={reading ? 'progressbar' : undefined} aria-label={reading ? windowLabel(reading) : undefined} aria-valuemin={reading ? 0 : undefined} aria-valuemax={reading ? 100 : undefined} aria-valuenow={reading ? percent : undefined}><i style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} /></span>
}

/** Everything known about one provider's limits. */
function UsageDetail({ provider, five, weekly, scoped }: ReturnType<typeof byProvider>[number]) {
  useLanguage()
  const all = [five, weekly, ...scoped].filter((r): r is UsageReading => !!r)
  const newest = Math.max(...all.map((r) => r.updatedAt))
  const plan = all.find((r) => r.plan)?.plan
  return <section className="usage-detail">
    <header><span className="usage-provider-icon"><ProviderIcon provider={provider} size={18} /></span><strong>{providerName(provider)}</strong>{plan && <span className="usage-plan">{plan}</span>}</header>
    {all.map((reading) => <div key={`${reading.window}:${reading.scope ?? ''}`} className="usage-detail-row">
      <div className="usage-detail-line"><span>{windowLabel(reading)}</span><span className={`usage-percent ${usageTone(reading)}`}>{reading.status === 'limited' ? t("Limit reached") : t("{0}% used", { "0": reading.usedPercent })}</span></div>
      <Bar reading={reading} size="large" />
      {resetText(reading.resetsAt) && <span className="muted small">{resetText(reading.resetsAt)}</span>}
    </div>)}
    <span className={`muted small usage-age${Date.now() - newest > STALE_MS ? ' stale' : ''}`}>{t("Updated ")}{ageText(newest)}{Date.now() - newest > STALE_MS ? ' · refreshes when this provider next runs' : ''}</span>
  </section>
}

function UsagePopover({ trigger, side = 'top', align = 'start' }: { trigger: React.ReactElement; side?: 'top' | 'bottom'; align?: 'start' | 'end' }) {
  useLanguage()
  const groups = byProvider(useUsage())
  return <Popover><PopoverTrigger render={trigger} /><PopoverContent side={side} align={align} sideOffset={6} className="usage-popover" aria-label={t("Plan usage")}>
    <div className="usage-popover-title"><Gauge size={15} /><strong>{t("Plan usage")}</strong></div>
    {groups.map((group) => <UsageDetail key={group.provider} {...group} />)}
    <p className="muted small usage-note">{t("Plan limits as the providers report them. Ramu switches before a limit when fallback is on.")}</p>
  </PopoverContent></Popover>
}

/** Pinned to the bottom of the sidebar: two thin bars per provider, the 5-hour window above the weekly one. */
export function UsageFooter() {
  useLanguage()
  const { preferences } = useAppSettings()
  const groups = byProvider(useUsage())
  if (!preferences.showUsageLimits || !groups.length) return null
  const label = groups.map(({ provider, five, weekly }) => `${providerName(provider)}: ${[five && `5-hour ${five.usedPercent}%`, weekly && `weekly ${weekly.usedPercent}%`].filter(Boolean).join(', ')}`).join('; ')
  return <UsagePopover trigger={<Button type="button" variant="ghost" className="usage-footer" aria-label={t("Plan usage. {0}", { "0": label })}>
    <span className="usage-footer-heading"><Gauge size={13} /><span>{t("Plan usage")}</span><ChevronUp size={13} /></span>
    {groups.map(({ provider, five, weekly }) => <span key={provider} className="usage-row">
      <span className="usage-provider-name"><ProviderIcon provider={provider} size={15} /><span>{providerName(provider)}</span></span>
      <span className="usage-bars">{[five, weekly].map((reading, index) => <span className="usage-mini-window" key={index}>
        <span className="usage-window-label">{index === 0 ? t('5h') : t('wk')}</span><Bar reading={reading} />
        <span className={`usage-value ${reading ? usageTone(reading) : 'unknown'}`}>{reading ? `${reading.usedPercent}%` : '–'}</span>
      </span>)}</span>
    </span>)}
  </Button>} />
}

/** With the sidebar hidden: one small ring per provider at the end of the status bar. */
export function UsageRings() {
  useLanguage()
  const { preferences } = useAppSettings()
  const all = useUsage()
  const groups = byProvider(all)
  if (!preferences.showUsageLimits || !groups.length) return null
  return <UsagePopover side="top" align="end" trigger={<Button type="button" className="ghost usage-rings" aria-label={t("Plan usage")}>
    {groups.map(({ provider }) => { const peak = peakUsage(all, provider)!; const r = 5.5, c = 2 * Math.PI * r
      return <span key={provider} className={`usage-ring ${usageTone(peak)}`} title={`${providerName(provider)} ${windowLabel(peak)} ${peak.usedPercent}%`}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r={r} className="track" /><circle cx="7" cy="7" r={r} className="fill" strokeDasharray={`${(peak.usedPercent / 100) * c} ${c}`} transform="rotate(-90 7 7)" /></svg>
      </span> })}
  </Button>} />
}

/** How full the chat's context window is: a small ring and percentage in the composer. Claude and Codex both report it. */
export function ContextMeter({ sessionId }: { sessionId: string }) {
  useLanguage()
  const [context, setContext] = useState<ContextUsage | null>(null)
  useEffect(() => {
    let cancelled = false
    setContext(null)
    void invoke('agent.context', sessionId).then((value) => { if (!cancelled) setContext(value) }, () => {})
    const off = ramu.on('context:changed', (event) => { if (event.sessionId === sessionId) setContext(event.context) })
    return () => { cancelled = true; off() }
  }, [sessionId])
  if (!context) return null
  const tone: UsageTone = context.percent >= 95 ? 'bad' : context.percent >= 80 ? 'warn' : 'ok'
  const r = 5.5, c = 2 * Math.PI * r, k = (n: number) => n >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : `${Math.round(n / 1000)}k`
  return <span className={`context-meter ${tone}`} role="img" aria-label={t("Context {0}% full", { "0": context.percent })} title={t("Context window: {0} of {1} tokens used{2}", { "0": k(context.used), "1": k(context.max), "2": tone === 'ok' ? '' : t('. Compaction happens automatically when it fills.') })}>
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r={r} className="track" /><circle cx="7" cy="7" r={r} className="fill" strokeDasharray={`${(context.percent / 100) * c} ${c}`} transform="rotate(-90 7 7)" /></svg>
    <span>{context.percent}%</span>
  </span>
}
