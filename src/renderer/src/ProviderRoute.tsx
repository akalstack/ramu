import { t, useLanguage } from './i18n'
import { ArrowRight, Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentSettings, FallbackStep, UsageReading } from '../../shared/types'
import { providerName } from '../../shared/providers'
import { useAppSettings } from './AppSettings'
import { invoke } from './ipc'
import { Menu } from './Menu'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { peakUsage, resetText, usageTone, useUsage, windowLabel } from './Usage'
import { defaultChain, peakFor, planRoute } from '../../shared/routing'

const WARN_AT = 80

/** Where the next message goes when the chat's provider is near its plan limit, before it is sent. */
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
  if (!switching) return <Menu label={`${reason}${resetText(peak.resetsAt) ? `, ${resetText(peak.resetsAt)}` : ''}`} className={`chip-btn [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:1px_solid_transparent] [&:hover:not(:disabled)]:text-foreground [&.on]:bg-hover [&.on]:[border:1px_solid_transparent] [&.on]:text-foreground h-7 min-h-7 p-[0_10px] rounded-(--radius-s) bg-transparent [border:1px_solid_transparent] [box-shadow:none] text-soft text-control [.composer-tray_&]:h-7 [.composer-tray_&]:min-h-7 [.composer-tray_&]:p-[0_8px] [.composer-tray_&]:gap-1.5 [.composer-tray_&]:[border:0] [.composer-tray_&]:rounded-full [.composer-tray_&]:bg-transparent [.composer-tray_&]:[box-shadow:none] [.composer-tray_&]:text-soft [.composer-tray_&]:text-caption [.composer-tray_&:hover:not(:disabled)]:[border:0] [.composer-tray_&:hover:not(:disabled)]:bg-hover [.composer-tray_&:hover:not(:disabled)]:text-foreground [.composer-tray_&.on]:[border:0] [.composer-tray_&.on]:bg-hover [.composer-tray_&.on]:text-foreground [.composer-tray_&_svg]:text-muted-foreground [border:none] p-[5px_10px] text-soft text-control gap-1.5 rounded-full bg-hover [box-shadow:inset_0_0_0_1px_var(--line)] route-chip [&.warn]:text-warn [&.warn]:[border-color:color-mix(in_srgb,_var(--warn)_35%,_transparent)] [&.bad]:text-bad [&.bad]:[border-color:color-mix(in_srgb,_var(--bad)_35%,_transparent)] [&.switching]:text-foreground [&.switching]:[border-color:var(--line-strong)] [&_.route-reason]:text-muted-foreground [&_.route-reason]:text-caption gap-1.5 text-soft ${usageTone(peak)}`} icon={<><Gauge size={13} /><span>{reason}</span></>} items={[
    { key: 'about', heading: resetText(peak.resetsAt) ?? t("Plan usage") },
    ...(hold ? [{ key: 'release', label: next ? t("Use the fallback ({0}) again", { "0": providerName(next.provider) }) : t("Use the fallback again"), onSelect: () => keep(null) }] : []),
    { key: 'settings', label: t("Fallback settings…"), onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'access' } })) },
  ]} />
  return <Menu label={t("Sending with {0}: {1}", { "0": providerName(next!.provider), "1": reason })} className={`chip-btn [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:1px_solid_transparent] [&:hover:not(:disabled)]:text-foreground [&.on]:bg-hover [&.on]:[border:1px_solid_transparent] [&.on]:text-foreground h-7 min-h-7 p-[0_10px] rounded-(--radius-s) bg-transparent [border:1px_solid_transparent] [box-shadow:none] text-soft text-control [.composer-tray_&]:h-7 [.composer-tray_&]:min-h-7 [.composer-tray_&]:p-[0_8px] [.composer-tray_&]:gap-1.5 [.composer-tray_&]:[border:0] [.composer-tray_&]:rounded-full [.composer-tray_&]:bg-transparent [.composer-tray_&]:[box-shadow:none] [.composer-tray_&]:text-soft [.composer-tray_&]:text-caption [.composer-tray_&:hover:not(:disabled)]:[border:0] [.composer-tray_&:hover:not(:disabled)]:bg-hover [.composer-tray_&:hover:not(:disabled)]:text-foreground [.composer-tray_&.on]:[border:0] [.composer-tray_&.on]:bg-hover [.composer-tray_&.on]:text-foreground [.composer-tray_&_svg]:text-muted-foreground [border:none] p-[5px_10px] text-soft text-control gap-1.5 rounded-full bg-hover [box-shadow:inset_0_0_0_1px_var(--line)] route-chip [&.warn]:text-warn [&.warn]:[border-color:color-mix(in_srgb,_var(--warn)_35%,_transparent)] [&.bad]:text-bad [&.bad]:[border-color:color-mix(in_srgb,_var(--bad)_35%,_transparent)] [&.switching]:text-foreground [&.switching]:[border-color:var(--line-strong)] [&_.route-reason]:text-muted-foreground [&_.route-reason]:text-caption gap-1.5 text-soft switching ${usageTone(peak)}`} icon={<><ArrowRight size={13} /><ProviderIcon provider={next!.provider} size={13} /><span>{name(next!)}</span><span className="route-reason">{reason}</span></>} items={[
    { key: 'about', heading: t("Next message goes to {0} with the conversation handed over", { "0": providerName(next!.provider) }) },
    { key: 'message', label: t("Keep {0} for this message", { "0": providerName(settings.provider) }), onSelect: () => keep('message') },
    { key: 'chat', label: t("Keep {0} for this chat", { "0": providerName(settings.provider) }), title: t("Until its limit resets"), onSelect: () => keep('chat') },
    { key: 'sep', separator: true },
    { key: 'settings', label: t("Fallback settings…"), onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'access' } })) },
  ]} />
}
