import { providerName } from '../../shared/providers'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { ChevronDown, ChevronRight, Gauge, Settings, SlidersHorizontal, Sparkles, Zap } from 'lucide-react'
import { useEffect, useState, type CSSProperties } from 'react'
import type { AgentSettings, ReasoningEffort } from '../../shared/types'
import { ReasoningPicker } from './ReasoningPicker'
import { ModelPicker } from './ModelPicker'
import { ProviderIcon } from './ProviderIcon'
import { Menu } from './Menu'
import { effortDisplayName, modelDisplayName, useModelSets } from './ModelSets'

export function ModelBar({ settings, onChange, disabled }: { settings: AgentSettings; onChange: (settings: AgentSettings) => void; disabled: boolean }) {
  const { preferences, catalogs } = useModelSets()
  const [picker, setPicker] = useState<'bar' | 'model' | 'effort'>('bar')
  const [setId, setSetId] = useState(preferences.defaultSetId)
  // While the slider is held, the bar previews the step under the thumb; the choice is applied when it is released.
  const [drag, setDrag] = useState<AgentSettings | null>(null)
  const shown = drag ?? settings
  const [mode, setMode] = useState<'effort' | 'model'>(preferences.defaultBarMode ?? 'model')
  useEffect(() => setMode(preferences.defaultBarMode ?? 'model'), [preferences.defaultBarMode])
  useEffect(() => { if (!preferences.sets.some((set) => set.id === setId)) setSetId(preferences.defaultSetId) }, [preferences, setId])
  const set = preferences.sets.find((entry) => entry.id === setId) ?? preferences.sets[0]!
  const models = catalogs.flatMap((catalog) => catalog.models)
  const model = models.find((entry) => entry.provider === shown.provider && entry.id === shown.model) ?? (!shown.model ? models.find((entry) => entry.provider === shown.provider && entry.isDefault) : undefined)
  const explicitEfforts = shown.provider === 'claude-code' || shown.provider === 'codex'
  const efforts: (ReasoningEffort | null)[] = [...(explicitEfforts ? [] : [null]), ...(model?.efforts ?? [])]
  const shownEffort = shown.effort ?? (explicitEfforts ? model?.defaultEffort ?? null : null)
  const steps = set.steps
  const match = steps.findIndex((step) => step.provider === shown.provider && (step.model === shown.model || !shown.model && step.model === model?.id) && step.effort === shown.effort)
  const index = mode === 'effort' ? efforts.indexOf(shownEffort) : match
  const count = mode === 'effort' ? efforts.length : steps.length
  const effortName = effortDisplayName(shownEffort, shown.provider)
  const modelName = modelDisplayName(model?.name ?? (shown.model || `${providerName(shown.provider)} default`))
  const available = (position: number) => {
    if (mode === 'effort') return true
    const step = steps[position]!
    const entry = models.find((entry) => entry.provider === step.provider && (entry.id === step.model || !step.model && entry.isDefault))
    const effort = step.effort
    return !!entry && (!effort || entry.efforts.includes(effort))
  }
  const settingsFor = (position: number): AgentSettings | null => {
    if (!available(position)) return null
    if (mode === 'effort') return { ...settings, effort: efforts[position] ?? null }
    const step = steps[position]!
    return { ...settings, provider: step.provider, model: step.model, effort: step.effort, serviceTier: models.find((entry) => entry.provider === step.provider && entry.id === step.model)?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority') ? settings.serviceTier : 'standard' }
  }
  const choose = (position: number) => { const next = settingsFor(position); if (next) onChange(next) }
  const fastSupported = settings.provider === 'codex' && !!model?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  const fast = settings.provider === 'codex' && settings.serviceTier === 'fast'
  const selectedText = `${modelName} ${effortName}`
  const fraction = count > 1 && index >= 0 ? index / (count - 1) : 0
  const chooseSet = (id: string) => {
    setSetId(id); setMode('model')
    const entry = preferences.sets.find((entry) => entry.id === id)!
    const step = entry.steps.find((step) => step.id === preferences.defaultStepId) ?? entry.steps[0]!
    const target = models.find((entry) => entry.provider === step.provider && (entry.id === step.model || !step.model && entry.isDefault))
    if (target && (!step.effort || target.efforts.includes(step.effort))) onChange({ ...settings, provider: step.provider, model: step.model, effort: step.effort, serviceTier: target.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority') ? settings.serviceTier : 'standard' })
  }
  return <Menu label="Model and effort controls" className="control-btn model-bar-trigger" disabled={disabled} onOpen={() => setPicker('bar')} menuClassName={`model-controls-menu ${picker === 'model' ? 'model-menu embedded-model-menu' : picker === 'effort' ? 'reasoning-menu' : 'model-bar-menu'}`} icon={<>{fast ? <Zap size={13} /> : <ProviderIcon provider={settings.provider} size={14} />}<span>{modelName} <span className="muted">{effortName}</span></span><ChevronDown size={12} /></>} items={[]} header={picker === 'model' ? <ModelPicker settings={settings} onChange={(next) => { setMode('effort'); onChange(next) }} onDone={() => setPicker('bar')} onSet={chooseSet} /> : picker === 'effort' ? <ReasoningPicker settings={settings} model={model} onChange={(next) => { if (next.effort !== settings.effort) setMode('effort'); onChange(next) }} onDone={() => setPicker('bar')} /> : <div className="model-bar-content" role="group" aria-label="Model and effort controls">
    <div className="model-bar-summary">
      <Button className="ghost icon model-bar-mode model-bar-fast" disabled={disabled || !fastSupported} aria-label="Codex fast mode" aria-pressed={fast} title={settings.provider !== 'codex' ? 'Fast mode is available with Codex' : !fastSupported ? 'Fast mode is unavailable for this model' : fast ? 'Fast mode on · Higher usage · Apply on send' : 'Enable Fast mode · Higher usage · Apply on send'} onClick={() => onChange({ ...settings, serviceTier: fast ? 'standard' : 'fast' })}><Zap size={15} /></Button>
      <div className="model-bar-title">
        <Button disabled={disabled} className="model-bar-model-name" aria-label={`Select model · ${modelName}`} onClick={() => setPicker('model')}><strong>{modelName}</strong><ChevronRight size={13} /></Button>
        <Button disabled={disabled} className="model-bar-effort-name" aria-label="Reasoning and service tier" onClick={() => setPicker('effort')}>{effortName}</Button>
      </div>
      <div className="model-bar-actions" role="group" aria-label="Model bar actions">
        <div className="model-bar-mode-switch" role="group" aria-label="Slider mode"><Button disabled={disabled} className="ghost icon model-bar-mode" aria-label="Effort only" aria-pressed={mode === 'effort'} title="Effort only · Keep the current model" onClick={() => setMode('effort')}><Gauge size={14} /></Button>
        <Button disabled={disabled} className="ghost icon model-bar-mode" aria-label="Model and effort" aria-pressed={mode === 'model'} title="Model + effort · Use the configured steps" onClick={() => setMode('model')}><SlidersHorizontal size={14} /></Button></div>
        <Button disabled={disabled} className="ghost icon model-bar-mode" aria-label="Model set settings" title="Model set settings" onClick={() => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'models' } }))}><Settings size={14} /></Button>
      </div>
    </div>
    <div className="model-bar-track" style={{ '--bar-fill': `calc(${fraction * 100}% + ${14 - 28 * fraction}px)` } as CSSProperties}>
      <div className="model-bar-dots" aria-hidden="true">{Array.from({ length: count }, (_, position) => <span key={position} className={available(position) ? '' : 'unavailable'} />)}</div>
      <Slider thumbLabel={mode === 'effort' ? 'Reasoning effort level' : 'Model set step'} valueText={selectedText} min={0} max={Math.max(1, count - 1)} step={1} value={Math.max(0, index)} disabled={disabled || count < 2} onKeyDown={(event) => event.stopPropagation()} onValueChange={(next) => { const position = typeof next === 'number' ? next : next[0]; if (position !== undefined) setDrag(settingsFor(position) ?? null) }} onValueCommitted={(next) => { const position = typeof next === 'number' ? next : next[0]; setDrag(null); if (position !== undefined) choose(position) }} />
    </div>
  </div>} />
}
