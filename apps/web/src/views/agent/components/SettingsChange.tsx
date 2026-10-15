import { RESPONSE_STYLE_LABELS } from '@ramu/shared/types'
import { t as translate } from '../../../i18n'
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
  const style = (s: AgentSettings) =>
    translate(
      s.responseStyle && s.responseStyle !== 'inherit' ? RESPONSE_STYLE_LABELS[s.responseStyle] : 'Use global style',
    )
  if (!previous)
    return <>{[label(next), accessName(next.access), tier(next), style(next)].filter(Boolean).join(' · ')}</>
  const changed = [
    [label(previous), label(next)],
    [accessName(previous.access), accessName(next.access)],
    [tier(previous), tier(next)],
    [style(previous), style(next)],
  ]
    .filter(([before, now]) => before && now && before !== now)
    .map(([before, now]) => `${before} → ${now}`)
  return <>{changed.length ? changed.join(' · ') : label(next)}</>
}
