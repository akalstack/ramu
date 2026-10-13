import { t, useLanguage } from './i18n'
import { ArrowRight, Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentSettings, FallbackStep, UsageReading } from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers'
import { useAppSettings } from './AppSettings'
import { invoke } from './ipc'
import { Menu } from './Menu'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { peakUsage, resetText, usageTone, useUsage, windowLabel } from './Usage'
import { defaultChain, peakFor, planRoute } from '@ramu/shared/routing'

const WARN_AT = 80

/** Where the next message goes when the chat's provider is near its plan limit, before it is sent. */
/** Soft filled pill: the background is the only thing that changes on hover, and there is no border, so nothing shifts. */
const CHIP = 'h-7 min-h-7 gap-1.5 rounded-full border-0 bg-fill px-2.5 text-caption font-normal text-soft [box-shadow:none] [transition:background-color_140ms_ease,color_140ms_ease] hover:bg-hover hover:text-foreground [&.on]:bg-hover [&.on]:text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground [&.warn]:bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] [&.warn]:text-warn [&.warn:hover]:bg-[color-mix(in_srgb,var(--warn)_20%,transparent)] [&.bad]:bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] [&.bad]:text-bad [&.bad:hover]:bg-[color-mix(in_srgb,var(--bad)_20%,transparent)] [&.warn_svg]:text-warn [&.bad_svg]:text-bad [&.switching]:text-foreground [&_.route-reason]:text-muted-foreground'

export function ProviderRouteChip({ sessionId, settings }: { sessionId: string; settings: AgentSettings }) {
  useLanguage()
  const usage = useUsage()
  const { preferences } = useAppSettings()
  const { catalogs } = useModelSets()
  const [hold, setHold] = useState<'message' | 'chat' | null>(null)
  useEffect(() => { void invoke('agent.providerHold', sessionId).then(setHold, () => {}) }, [sessionId])
  const now = Date.now()
  // Readings count only until their window resets, exactly as the main process sees them.
  const peak = peakFor(usage, settings.provider, settings.model, now)
  if (!preferences.showUsageLimits || !peak || (peak.usedPercent < WARN_AT && peak.status !== 'limited')) return null
  const chain = preferences.fallback.chains[settings.provider] ?? defaultChain(settings.provider, catalogs)
  // The chat's own flag decides: the global default only seeds it when a chat starts.
  const route = planRoute(settings, chain, { usage, catalogs, switchAt: preferences.fallback.switchAt, now })
  const next: FallbackStep | undefined = route?.step
  const switching = !!route && !hold
  const reason = `${providerName(settings.provider)} ${windowLabel(peak, true)} ${peak.status === 'limited' ? t('limited') : `${peak.usedPercent}%`}`
  const keep = (scope: 'message' | 'chat' | null) => { setHold(scope); void invoke('agent.holdProvider', sessionId, scope).catch(() => {}) }
  const name = (step: FallbackStep) => { const model = catalogs.find((c) => c.provider === step.provider)?.models.find((m) => m.id === step.model); return model ? modelDisplayName(model.name) : providerName(step.provider) }
  if (!switching) return <Menu label={`${reason}${resetText(peak.resetsAt) ? `, ${resetText(peak.resetsAt)}` : ''}`} className={`route-chip ${usageTone(peak)} ${CHIP}`} icon={<><Gauge size={13} /><span>{reason}</span></>} items={[
    { key: 'about', heading: resetText(peak.resetsAt) ?? t("Plan usage") },
    ...(hold ? [{ key: 'release', label: next ? t("Use the fallback ({0}) again", { "0": providerName(next.provider) }) : t("Use the fallback again"), onSelect: () => keep(null) }] : []),
    { key: 'settings', label: t("Fallback settings…"), onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'access' } })) },
  ]} />
  return <Menu label={t("Sending with {0}: {1}", { "0": providerName(next!.provider), "1": reason })} className={`route-chip switching ${usageTone(peak)} ${CHIP}`} icon={<><ArrowRight size={13} /><ProviderIcon provider={next!.provider} size={13} /><span>{name(next!)}</span><span className="route-reason">{reason}</span></>} items={[
    { key: 'about', heading: t("Next message goes to {0} with the conversation handed over", { "0": providerName(next!.provider) }) },
    { key: 'message', label: t("Keep {0} for this message", { "0": providerName(settings.provider) }), onSelect: () => keep('message') },
    { key: 'chat', label: t("Keep {0} for this chat", { "0": providerName(settings.provider) }), title: t("Until its limit resets"), onSelect: () => keep('chat') },
    { key: 'sep', separator: true },
    { key: 'settings', label: t("Fallback settings…"), onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'access' } })) },
  ]} />
}
