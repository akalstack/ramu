import { Badge } from '@/components/ui/badge'
import { Check } from 'lucide-react'
import type { AgentModel, AgentSettings } from '../../shared/types'
import { MenuItems, type MenuEntry } from './Menu'
import { effortDisplayName } from './ModelSets'

export function ReasoningPicker({ settings, model, onChange, onDone }: { settings: AgentSettings; model?: AgentModel; onChange: (settings: AgentSettings) => void; onDone: () => void }) {
  const fastSupported = settings.provider === 'codex' && !!model?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  const explicitEfforts = settings.provider === 'claude-code' || settings.provider === 'codex'
  const selectedEffort = settings.effort ?? (explicitEfforts ? model?.defaultEffort ?? null : null)
  const items: MenuEntry[] = [
    { key: 'reasoning', heading: 'Reasoning' },
    ...(!explicitEfforts ? [{ key: 'default', selected: !settings.effort, label: <><span className="grow">Model default</span>{!settings.effort && <Check size={13} />}</>, onSelect: () => onChange({ ...settings, effort: null }) }] : []),
    ...(model?.efforts ?? []).map((effort) => ({ key: effort, selected: selectedEffort === effort, label: <><span className="grow">{effortDisplayName(effort, settings.provider)}</span>{!explicitEfforts && effort === model?.defaultEffort && <Badge variant="outline" className="chip">Default</Badge>}{selectedEffort === effort && <Check size={13} />}</>, onSelect: () => onChange({ ...settings, effort }) })),
  ]
  if (settings.provider === 'codex') items.push(
    { key: 'separator', separator: true }, { key: 'tier', heading: 'Service Tier' },
    { key: 'standard', selected: settings.serviceTier !== 'fast', label: <><span className="grow">Standard</span>{settings.serviceTier !== 'fast' && <Check size={13} />}</>, onSelect: () => onChange({ ...settings, serviceTier: 'standard' }) },
    { key: 'fast', selected: settings.serviceTier === 'fast', disabled: !fastSupported, label: <><span className="grow">Fast<span className="muted block">{fastSupported ? 'Faster responses, higher usage' : 'Unavailable for this model'}</span></span>{settings.serviceTier === 'fast' && <Check size={13} />}</>, onSelect: () => onChange({ ...settings, serviceTier: 'fast' }) },
  )
  return <div role="menu" aria-label="Reasoning and service tier"><MenuItems items={items} close={onDone} /></div>
}
