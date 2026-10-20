import { t, useLanguage } from '../i18n'
import { ArrowRight, Gauge } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AgentSessionInfo, AgentSettings, FallbackStep } from '@ramu/shared/types'
import { providerName, providerAccountOrder, accountDisplayName } from '@ramu/shared/providers/providers'
import { useAppSettings } from '../settings/AppSettings'
import { useHost } from '../workspace/HostProvider'
import { Menu, type MenuEntry } from '../Menu'
import { autoResumeLabel, autoResumeSection, type AutoResumeControl } from './autoResumeMenu'
import { continueOptions, settingsOnStep } from './continueWith'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../workspace/TaskPane'
import { modelDisplayName, useModelSets } from './ModelSets'
import { ProviderIcon } from './ProviderIcon'
import { resetText, usageTone, useUsage, useAccountUsage, windowLabel } from '../settings/Usage'
import { defaultOrder, peakFor, planRoute, resolveStep } from '@ramu/shared/providers/routing'

const WARN_AT = 80

/** Shows usage-limit fallback for the next message. */
/** Soft filled pill: the background is the only thing that changes on hover, and there is no border, so nothing shifts. */
const CHIP =
  'h-7 min-h-7 gap-1.5 rounded-full border-0 bg-fill px-2.5 text-caption font-normal text-soft [box-shadow:none] [transition:background-color_140ms_ease,color_140ms_ease] hover:bg-hover hover:text-foreground [&.on]:bg-hover [&.on]:text-foreground [&_svg]:flex-none [&_svg]:text-muted-foreground [&.warn]:bg-[color-mix(in_srgb,var(--warn)_12%,transparent)] [&.warn]:text-warn [&.warn:hover]:bg-[color-mix(in_srgb,var(--warn)_20%,transparent)] [&.bad]:bg-[color-mix(in_srgb,var(--bad)_12%,transparent)] [&.bad]:text-bad [&.bad:hover]:bg-[color-mix(in_srgb,var(--bad)_20%,transparent)] [&.warn_svg]:text-warn [&.bad_svg]:text-bad [&.switching]:text-foreground [&_.route-reason]:text-muted-foreground'

/** The chip when there is nothing to warn about: an icon with no fill, so the composer row looks as it did. */
const QUIET_CHIP =
  'route-chip h-7 min-h-7 w-7 justify-center gap-0 rounded-full border-0 bg-transparent p-0 text-muted-foreground [box-shadow:none] [transition:background-color_140ms_ease,color_140ms_ease] hover:bg-hover hover:text-foreground [&.on]:bg-hover [&.on]:text-foreground [&_svg]:flex-none'

export function ProviderRouteChip({
  sessionId,
  settings,
  limited = false,
  autoResume,
  onSession,
}: {
  sessionId: string
  settings: AgentSettings
  /** The thread is at a usage limit right now: the chip marks "Limit reached" and always shows. */
  limited?: boolean
  /** This thread's Auto-resume choice, offered in the menu so it can be set before a limit too. */
  autoResume?: AutoResumeControl
  /** Receives the thread after "Continue with …" moved it to another provider. */
  onSession?: (session: AgentSessionInfo) => void
}) {
  useLanguage()
  const { invoke } = useHost()
  const selectedUsage = useUsage()
  const allUsage = useAccountUsage()
  const usage = allUsage.length ? allUsage : selectedUsage
  const { preferences } = useAppSettings()
  const { catalogs } = useModelSets()
  const [hold, setHold] = useState<'message' | 'chat' | 'picked' | null>(null)
  // Refresh any explicit usage-limit hold when the model changes.
  useEffect(() => {
    void invoke('agent.providerHold', sessionId).then(setHold, () => {})
  }, [sessionId, settings.provider, settings.model, invoke])
  const now = Date.now()
  // Readings count only until their window resets, exactly as the main process sees them.
  const accountId =
    settings.accountId ?? providerAccountOrder(preferences.providerBinaries, settings.provider)[0] ?? 'default'
  const ownUsage = usage.filter(
    (reading) => reading.provider !== settings.provider || (reading.accountId ?? 'default') === accountId,
  )
  const model =
    resolveStep({ id: '', provider: settings.provider, model: settings.model, effort: null }, catalogs)?.model ??
    settings.model
  const peak = peakFor(ownUsage, settings.provider, model, now)
  const warn = preferences.showUsageLimits && !!peak && (peak.usedPercent >= WARN_AT || peak.status === 'limited')
  const order = preferences.fallback.order ?? defaultOrder(catalogs)
  // The chat's own flag decides: the global default only seeds it when a chat starts.
  const route = planRoute(settings, order, {
    usage: ownUsage,
    accounts: { configuration: preferences.providerBinaries, usage },
    catalogs,
    switchAt: preferences.fallback.switchAt,
    now,
  })
  const settingsItem = {
    key: 'settings',
    label: t('Fallback settings…'),
    onSelect: () =>
      window.dispatchEvent(
        new CustomEvent('ramu:settings', { detail: { section: 'models', target: 'Provider fallback' } }),
      ),
  }
  const resumeItems: MenuEntry[] = autoResume
    ? [...autoResumeSection(autoResume), { key: 'auto-resume-sep', separator: true }]
    : []
  // Nothing to warn about: a quiet icon, so Auto-resume can still be set (or cleared) before a limit, in the same menu.
  if (!warn && !limited) {
    if (!autoResume) return null
    return (
      <Menu
        label={autoResumeLabel(autoResume)}
        className={QUIET_CHIP}
        icon={<Gauge size={13} />}
        items={[...resumeItems, settingsItem]}
      />
    )
  }
  const next = route?.step
  const held = hold === 'message' || hold === 'chat'
  const switching = !!route && !held
  const reason = peak
    ? `${providerName(settings.provider)} ${windowLabel(peak, true)} ${peak.status === 'limited' ? t('limited') : `${peak.usedPercent}%`}`
    : t('Plan usage')
  const tone = peak ? usageTone(peak) : ''
  const keep = (scope: 'message' | 'chat' | null) => {
    setHold(scope)
    void invoke('agent.holdProvider', sessionId, scope).catch(() => {})
  }
  const name = (step: FallbackStep & { accountId?: string }) => {
    const model = catalogs.find((c) => c.provider === step.provider)?.models.find((m) => m.id === step.model)
    const name = model ? modelDisplayName(model.name) : providerName(step.provider)
    if (step.accountId === undefined) return name
    const account = accountDisplayName(preferences.providerBinaries, step.provider, step.accountId)
    return `${name} · ${account.name || (account.fallback === 'default' ? t('Default account') : t('Account {0}', { '0': account.number }))}`
  }
  // Held at a limit: other providers that are not known to be limited, to continue on right now with the conversation handed over.
  const continueItems = (): MenuEntry[] => {
    const steps = continueOptions({ settings, order, catalogs, usage: selectedUsage, now })
    if (!steps.length) return []
    return [
      { key: 'continue-heading', heading: t('Continue on another provider') },
      ...steps.map((step) => ({
        key: `continue-${step.provider}`,
        label: t('Continue with {0}', { '0': providerName(step.provider) }),
        title: t('Hands the conversation over and sends it now'),
        onSelect: () => continueWith(step),
      })),
      { key: 'continue-sep', separator: true as const },
    ]
  }
  const continueWith = (step: FallbackStep) => {
    // Switching hands the conversation over; trying again then continues the held request on the new provider.
    void invoke('agent.configure', sessionId, settingsOnStep(settings, step))
      .then((updated) => {
        onSession?.(updated)
        return invoke('agent.retryLimitNow', sessionId)
      })
      .catch((error) => notifyError(errorText(error), 'Model'))
  }
  if (limited)
    return (
      <Menu
        label={t('{0} · Limit reached', { '0': providerName(settings.provider) })}
        className={`route-chip warn ${CHIP}`}
        icon={
          <>
            <Gauge size={13} />
            <span>{t('Limit reached')}</span>
          </>
        }
        items={[
          { key: 'about', heading: t('{0} · Limit reached', { '0': providerName(settings.provider) }) },
          ...continueItems(),
          ...resumeItems,
          settingsItem,
        ]}
      />
    )
  const release =
    held && next
      ? [
          {
            key: 'release',
            label: t('Use the fallback ({0}) again', { '0': providerName(next.provider) }),
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
        items={[...release, ...resumeItems, settingsItem]}
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
        items={[
          { key: 'about', heading: resetText(peak!.resetsAt) ?? t('Plan usage') },
          ...release,
          ...resumeItems,
          settingsItem,
        ]}
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
          heading: t('Next message goes to {0} with the conversation handed over', {
            '0': providerName(next!.provider),
          }),
        },
        {
          key: 'message',
          label: t('Keep {0} for this message', { '0': providerName(settings.provider) }),
          onSelect: () => keep('message'),
        },
        {
          key: 'chat',
          label: t('Keep {0} for this thread', { '0': providerName(settings.provider) }),
          title: t('Until its limit resets'),
          onSelect: () => keep('chat'),
        },
        { key: 'sep', separator: true },
        ...resumeItems,
        settingsItem,
      ]}
    />
  )
}
