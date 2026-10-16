import { t as translate } from '../../../i18n'
import { Fragment } from 'react'
import { ArrowRight } from 'lucide-react'
import { ProviderIcon } from '../../../models/ProviderIcon'
import type { AgentSettings } from '@ramu/shared/types'
import { accessName } from '../../../chat/AgentControls'
import { settingsNames, useModelSets } from '../../../models/ModelSets'

/** What the button does, not just "Undo": "Switch back to Opus Medium". */
export function SwitchBackLabel({ previous }: { previous: AgentSettings }) {
  const { catalogs } = useModelSets()
  const { model, effort } = settingsNames(previous, catalogs)
  return <>{translate('Switch back to {0}', { '0': effort ? `${model} ${effort}` : model })}</>
}

/** A settings change in the transcript: "model effort → model effort", then any other part that changed as "old → new". */
export function SettingsChange({ next, previous }: { next: AgentSettings; previous?: AgentSettings }) {
  const { catalogs } = useModelSets()
  const label = (s: AgentSettings) => {
    const { model, effort } = settingsNames(s, catalogs)
    return effort ? `${model} ${effort}` : model
  }
  const tier = (s: AgentSettings) => (s.provider === 'codex' ? (s.serviceTier === 'fast' ? 'Fast' : 'Standard') : null)
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
