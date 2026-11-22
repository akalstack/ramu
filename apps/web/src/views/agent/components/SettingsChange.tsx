import { accountName } from '@ramu/shared/providers/providers'
import { useAppSettings } from '../../../settings/AppSettings'
import { t as translate } from '../../../i18n'
import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'
import { ProviderIcon } from '../../../models/ProviderIcon'
import type { AgentSettings } from '@ramu/shared/types'
import { accessName } from '../../../chat/AgentControls'
import { settingsNames, useModelSets } from '../../../models/ModelSets'

/** A login by name, as the account picker shows it. */
function useLoginName() {
  const { preferences } = useAppSettings()
  return (s: AgentSettings) =>
    accountName(preferences.providerBinaries, s.provider, s.accountId ?? 'default', undefined, translate)
}

const sameLogin = (a: AgentSettings, b: AgentSettings) =>
  a.provider !== b.provider || (a.accountId ?? 'default') === (b.accountId ?? 'default')

/**
 * What the button does, not just "Undo": "Switch back to Opus Medium", or to the earlier login when only the login
 * changed.
 */
export function SwitchBackLabel({ previous, next }: { previous: AgentSettings; next?: AgentSettings }) {
  const { catalogs } = useModelSets()
  const loginName = useLoginName()
  const { model, effort } = settingsNames(previous, catalogs)
  const sameModel = next && settingsNames(next, catalogs).model === model && next.provider === previous.provider
  if (next && sameModel && !sameLogin(previous, next))
    return <>{translate('Switch back to {0}', { '0': loginName(previous) })}</>
  return <>{translate('Switch back to {0}', { '0': effort ? `${model} ${effort}` : model })}</>
}

/** A settings change in the transcript: "model effort → model effort", then any other part that changed as "old → new". */
export function SettingsChange({ next, previous }: { next: AgentSettings; previous?: AgentSettings }) {
  const { catalogs } = useModelSets()
  const loginName = useLoginName()
  const label = (s: AgentSettings) => {
    const { model, effort } = settingsNames(s, catalogs)
    return effort ? `${model} ${effort}` : model
  }
  // Codex always names its speed; Claude only when the thread runs in fast mode, which most of its models lack.
  const tier = (s: AgentSettings) =>
    s.provider === 'codex'
      ? s.serviceTier === 'fast'
        ? 'Fast'
        : 'Standard'
      : s.provider === 'claude-code' && s.serviceTier === 'fast'
        ? 'Fast'
        : null
  const modelLabel = (settings: AgentSettings) => (
    <span className="inline-flex items-center gap-1.5">
      <ProviderIcon provider={settings.provider} size={13} />
      {label(settings)}
    </span>
  )
  if (!previous)
    return (
      <span className="inline-flex flex-wrap items-center justify-center gap-x-2">
        {modelLabel(next)} · {[accessName(next.access), tier(next)].filter(Boolean).join(' · ')}
      </span>
    )
  const changed = [
    [accessName(previous.access), accessName(next.access)],
    [tier(previous), tier(next)],
    // The login is part of what runs the model: a switch between two logins of one model says which, by name.
    sameLogin(previous, next) ? [null, null] : [loginName(previous), loginName(next)],
  ]
    .filter(([before, now]) => before && now && before !== now)
    .map(([before, now]) => `${before} → ${now}`)
  return (
    <span className="inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1">
      {(previous.provider !== next.provider || label(previous) !== label(next)) && (
        <>
          {modelLabel(previous)}
          <ArrowRight size={13} aria-label="→" />
          {modelLabel(next)}
        </>
      )}
      {previous.provider === next.provider && label(previous) === label(next) && modelLabel(next)}
      {changed.map((change, index) => (
        <Fragment key={index}>
          <span aria-hidden="true">·</span>
          <span>{change}</span>
        </Fragment>
      ))}
    </span>
  )
}
