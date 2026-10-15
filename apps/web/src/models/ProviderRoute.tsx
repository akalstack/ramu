import { t, useLanguage } from '../i18n'
import { ArrowRight, Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentSettings, FallbackStep } from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers/providers'
import { useAppSettings } from '../settings/AppSettings'
import { invoke } from '../ipc'
import { Menu } from '../Menu'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { resetText, usageTone, useUsage, windowLabel } from '../settings/Usage'
import { defaultOrder, peakFor, planRoute } from '@ramu/shared/providers/routing'

const WARN_AT = 80

/** Where the next message goes before it is sent: on from a model near its limit, or up to a higher-ranked one. */
/** Soft filled pill: the background is the only thing that changes on hover, and there is no border, so nothing shifts. */
const CHIP =
  'h-7 min-h-7 gap-1.5 rounded-full border-0 bg-fill px-2.5 text-caption font-normal text-soft [box-shadow:none] [transition:background-color_140ms_ease,color_140ms_ease] hover:bg-hover hover:text-foreground [&.on]:bg-hover [&.on]:text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground [&.warn]:bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] [&.warn]:text-warn [&.warn:hover]:bg-[color-mix(in_srgb,var(--warn)_20%,transparent)] [&.bad]:bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] [&.bad]:text-bad [&.bad:hover]:bg-[color-mix(in_srgb,var(--bad)_20%,transparent)] [&.warn_svg]:text-warn [&.bad_svg]:text-bad [&.switching]:text-foreground [&_.route-reason]:text-muted-foreground'

export function ProviderRouteChip({ sessionId, settings }: { sessionId: string; settings: AgentSettings }) {
  useLanguage()
  const usage = useUsage()
  const { preferences } = useAppSettings()
  const { catalogs } = useModelSets()
  const [hold, setHold] = useState<'message' | 'chat' | 'picked' | null>(null)
  // Picking a model by hand pins the chat on the server, so ask again when the model changes.
  useEffect(() => {
    void invoke('agent.providerHold', sessionId).then(setHold, () => {})
  }, [sessionId, settings.provider, settings.model])
  const now = Date.now()
  // Readings count only until their window resets, exactly as the main process sees them.
  const peak = peakFor(usage, settings.provider, settings.model, now)
  const warn = preferences.showUsageLimits && !!peak && (peak.usedPercent >= WARN_AT || peak.status === 'limited')
  const order = preferences.fallback.order ?? defaultOrder(catalogs)
  // The chat's own flag decides: the global default only seeds it when a chat starts.
  const route = planRoute(settings, order, {
    usage,
    catalogs,
    switchAt: preferences.fallback.switchAt,
    now,
    promote: hold !== 'picked',
  })
  const moveUp = !!route && !route.peak
  if (!warn && !moveUp) return null
  const next: FallbackStep | undefined = route?.step
  const held = hold === 'message' || hold === 'chat'
  const switching = !!route && !held
  const reason =
    peak && !moveUp
      ? `${providerName(settings.provider)} ${windowLabel(peak, true)} ${peak.status === 'limited' ? t('limited') : `${peak.usedPercent}%`}`
      : t('Higher in your order')
  const tone = peak ? usageTone(peak) : ''
  const keep = (scope: 'message' | 'chat' | null) => {
    setHold(scope)
    void invoke('agent.holdProvider', sessionId, scope).catch(() => {})
  }
  const name = (step: FallbackStep) => {
    const model = catalogs.find((c) => c.provider === step.provider)?.models.find((m) => m.id === step.model)
    return model ? modelDisplayName(model.name) : providerName(step.provider)
  }
  const settingsItem = {
    key: 'settings',
    label: t('Fallback settings…'),
    onSelect: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'access' } })),
  }
  const release =
    held && next
      ? [
          {
            key: 'release',
            label: moveUp
              ? t('Move up to {0}', { '0': name(next) })
              : t('Use the fallback ({0}) again', { '0': providerName(next.provider) }),
            onSelect: () => keep(null),
          },
        ]
      : held
        ? [{ key: 'release', label: t('Use the fallback again'), onSelect: () => keep(null) }]
        : []
  if (!switching && (!peak || !warn))
    return (
      <Menu
        label={t('Keeping {0}', { '0': providerName(settings.provider) })}
        className={`route-chip ${CHIP}`}
        icon={
          <>
            <Gauge size={13} />
            <span>{t('Keeping {0}', { '0': providerName(settings.provider) })}</span>
          </>
        }
        items={[...release, settingsItem]}
      />
    )
  if (!switching)
    return (
      <Menu
        label={`${reason}${resetText(peak!.resetsAt) ? `, ${resetText(peak!.resetsAt)}` : ''}`}
        className={`route-chip ${tone} ${CHIP}`}
        icon={
          <>
            <Gauge size={13} />
            <span>{reason}</span>
          </>
        }
        items={[{ key: 'about', heading: resetText(peak!.resetsAt) ?? t('Plan usage') }, ...release, settingsItem]}
      />
    )
  return (
    <Menu
      label={t('Sending with {0}: {1}', { '0': providerName(next!.provider), '1': reason })}
      className={`route-chip switching ${tone} ${CHIP}`}
      icon={
        <>
          <ArrowRight size={13} />
          <ProviderIcon provider={next!.provider} size={13} />
          <span>{name(next!)}</span>
          <span className="route-reason">{reason}</span>
        </>
      }
      items={[
        {
          key: 'about',
          heading: moveUp
            ? t('Next message moves up to {0}, higher in your fallback order', { '0': name(next!) })
            : t('Next message goes to {0} with the conversation handed over', { '0': providerName(next!.provider) }),
        },
        {
          key: 'message',
          label: t('Keep {0} for this message', { '0': providerName(settings.provider) }),
          onSelect: () => keep('message'),
        },
        {
          key: 'chat',
          label: t('Keep {0} for this chat', { '0': providerName(settings.provider) }),
          ...(moveUp ? {} : { title: t('Until its limit resets') }),
          onSelect: () => keep('chat'),
        },
        { key: 'sep', separator: true },
        settingsItem,
      ]}
    />
  )
}
