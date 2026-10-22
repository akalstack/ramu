import { t, useLanguage } from '../i18n'
import { providerName } from '@ramu/shared/providers/providers'
import { StepSlider } from '@/components/step-slider'
import { Button } from '@/components/desktop-button'
import { Check, ChevronDown, ChevronRight, Clock3, Gauge, Settings, SlidersHorizontal, X, Zap } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AgentSettings, ReasoningEffort } from '@ramu/shared/types'
import { ReasoningPicker } from './ReasoningPicker'
import { ModelPicker } from './ModelPicker'
import { ProviderIcon } from './ProviderIcon'
import { Menu } from '../Menu'
import { effortDisplayName, modelDisplayName, settingsNames, useModelSets } from './ModelSets'
import { notifyError } from '../chat/Notifications'
import { errorText } from '../lib/errors'

/** `current` is what the chat runs now; a different choice waiting for the next send shows in the transcript. */
export function ModelBar({
  settings: value,
  current,
  onChange,
  disabled,
  running = false,
}: {
  settings: AgentSettings
  current?: AgentSettings
  onChange: (settings: AgentSettings) => void
  disabled: boolean
  running?: boolean
}) {
  useLanguage()
  const { preferences, catalogs, save } = useModelSets()
  type PendingModel = { choice: Pick<AgentSettings, 'provider' | 'model' | 'effort' | 'serviceTier'>; deadline: number }
  const [pending, setPending] = useState<PendingModel | null>(null)
  const pendingRef = useRef<PendingModel | null>(null)
  const [seconds, setSeconds] = useState(5)
  const latest = useRef({ value, onChange, running, disabled })
  latest.current = { value, onChange, running, disabled }
  const settings = pending ? { ...value, ...pending.choice } : value
  const clearPending = () => {
    pendingRef.current = null
    setPending(null)
  }
  const stage = (next: AgentSettings, deadline: number) => {
    const choice = { provider: next.provider, model: next.model, effort: next.effort, serviceTier: next.serviceTier }
    const update = { choice, deadline }
    pendingRef.current = update
    setPending(update)
  }
  const applyPending = () => {
    const next = pendingRef.current
    clearPending()
    if (next && latest.current.running && !latest.current.disabled)
      latest.current.onChange({ ...latest.current.value, ...next.choice })
  }
  const change = (next: AgentSettings) => {
    if (pendingRef.current) stage(next, pendingRef.current.deadline)
    else onChange(next)
  }
  const selectModel = (next: AgentSettings) => {
    if (!running) {
      clearPending()
      onChange(next)
      return
    }
    const applied = current ?? value
    if (next.provider === applied.provider && next.model === applied.model) {
      clearPending()
      return
    }
    const deadline = Date.now() + 5000
    setSeconds(5)
    stage(next, deadline)
  }
  const applied = current ?? value
  const appliedKey = `${applied.provider}:${applied.model}:${applied.effort ?? ''}`
  useEffect(() => {
    clearPending()
  }, [running, disabled, appliedKey])
  useEffect(() => {
    if (!pending || !running || disabled) return
    const tick = () => {
      const next = pendingRef.current
      if (!next) return
      setSeconds(Math.max(0, Math.ceil((next.deadline - Date.now()) / 1000)))
      if (Date.now() >= next.deadline) {
        applyPending()
      }
    }
    const timer = window.setInterval(tick, 100)
    return () => window.clearInterval(timer)
  }, [pending?.deadline, running, disabled])

  const [picker, setPicker] = useState<'bar' | 'model' | 'effort'>('bar')
  const [setId, setSetId] = useState(preferences.defaultSetId)
  // While the slider is held, the bar previews the step under the thumb; the choice is applied when it is released.
  const [drag, setDrag] = useState<AgentSettings | null>(null)
  const shown = drag ?? settings
  const [mode, setSelectedMode] = useState<'effort' | 'model'>(preferences.defaultBarMode ?? 'model')
  useEffect(() => setSelectedMode(preferences.defaultBarMode ?? 'model'), [preferences.defaultBarMode])
  const setMode = (next: 'effort' | 'model') => {
    setSelectedMode(next)
    if (next !== (preferences.defaultBarMode ?? 'model'))
      void save({ ...preferences, defaultBarMode: next }).catch((error) => notifyError(errorText(error), 'Model'))
  }
  useEffect(() => {
    if (!preferences.sets.some((set) => set.id === setId)) setSetId(preferences.defaultSetId)
  }, [preferences, setId])
  const set = preferences.sets.find((entry) => entry.id === setId) ?? preferences.sets[0]!
  const models = catalogs.flatMap((catalog) => catalog.models)
  const model =
    models.find((entry) => entry.provider === shown.provider && entry.id === shown.model) ??
    (!shown.model ? models.find((entry) => entry.provider === shown.provider && entry.isDefault) : undefined)
  const efforts: ReasoningEffort[] = model?.efforts ?? []
  const shownEffort = shown.effort ?? model?.defaultEffort ?? null
  const steps = set.steps
  const match = steps.findIndex(
    (step) =>
      step.provider === shown.provider &&
      (step.model === shown.model || (!shown.model && step.model === model?.id)) &&
      step.effort === shown.effort,
  )
  const index = mode === 'effort' ? (shownEffort ? efforts.indexOf(shownEffort) : -1) : match
  const count = mode === 'effort' ? efforts.length : steps.length
  const effortName = effortDisplayName(shownEffort, shown.provider)
  const modelName = modelDisplayName(model?.name ?? (shown.model || `${providerName(shown.provider)} default`))
  const available = (position: number) => {
    if (mode === 'effort') return true
    const step = steps[position]!
    const entry = models.find(
      (entry) => entry.provider === step.provider && (entry.id === step.model || (!step.model && entry.isDefault)),
    )
    const effort = step.effort
    return !!entry && (!effort || entry.efforts.includes(effort))
  }
  const settingsFor = (position: number): AgentSettings | null => {
    if (!available(position)) return null
    if (mode === 'effort') return { ...settings, effort: efforts[position] ?? null }
    const step = steps[position]!
    return {
      ...settings,
      provider: step.provider,
      model: step.model,
      effort: step.effort,
      serviceTier: models
        .find((entry) => entry.provider === step.provider && entry.id === step.model)
        ?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
        ? settings.serviceTier
        : 'standard',
    }
  }
  const choose = (position: number) => {
    const next = settingsFor(position)
    if (!next) return
    if (mode === 'effort') change(next)
    else {
      clearPending()
      onChange(next)
    }
  }
  const fastSupported =
    settings.provider === 'codex' && !!model?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  const fast = settings.provider === 'codex' && settings.serviceTier === 'fast'
  const selectedText = `${modelName} ${effortName}`
  const fraction = count > 1 && index >= 0 ? index / (count - 1) : 0
  const chooseSet = (id: string) => {
    setSetId(id)
    setMode('model')
    const entry = preferences.sets.find((entry) => entry.id === id)!
    const step = entry.steps.find((step) => step.id === preferences.defaultStepId) ?? entry.steps[0]!
    const target = models.find(
      (entry) => entry.provider === step.provider && (entry.id === step.model || (!step.model && entry.isDefault)),
    )
    if (target && (!step.effort || target.efforts.includes(step.effort)))
      selectModel({
        ...settings,
        provider: step.provider,
        model: step.model,
        effort: step.effort,
        serviceTier: target.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
          ? settings.serviceTier
          : 'standard',
      })
  }
  return (
    <>
      <Menu
        standard
        label={t('Model and effort controls')}
        className="control-btn model-bar-trigger h-8 min-w-0 gap-2 px-2 text-sm [&>span]:truncate"
        disabled={disabled}
        onOpen={() => setPicker('bar')}
        menuClassName={`model-controls-menu ${picker === 'model' ? 'model-menu w-[256px] max-h-[min(420px,_calc(100vh_-_24px))] overflow-y-auto embedded-model-menu [&:has(.model-picker)]:w-[380px] [&:has(.model-picker)]:p-0 [&:has(.model-picker)]:max-h-[none] [&:has(.model-picker)]:overflow-hidden [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgb(var(--ink)_/_0.07)] w-[300px] max-w-[calc(100vw_-_16px)] max-h-[min(480px,_calc(100vh_-_16px))] overflow-y-auto' : picker === 'effort' ? 'reasoning-menu w-[240px]' : 'model-bar-menu [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgb(var(--ink)_/_0.07)] max-w-[calc(100vw_-_16px)] w-[340px] p-0'}`}
        icon={
          <>
            {fast ? <Zap size={13} /> : <ProviderIcon provider={settings.provider} size={14} />}
            <span title={pending ? t('Applying model in {0}s', { 0: seconds }) : undefined}>
              {modelName} <span className="muted text-muted-foreground">{effortName}</span>
            </span>
            <ChevronDown size={12} />
          </>
        }
        items={[]}
        header={
          picker === 'model' ? (
            <ModelPicker
              settings={settings}
              onChange={(next) => {
                setMode('effort')
                selectModel(next)
              }}
              onDone={() => setPicker('bar')}
              onSet={chooseSet}
            />
          ) : picker === 'effort' ? (
            <ReasoningPicker
              settings={settings}
              model={model}
              onChange={(next) => {
                if (next.effort !== settings.effort) setMode('effort')
                change(next)
              }}
              onDone={() => setPicker('bar')}
            />
          ) : (
            <div
              className="model-bar-content [.model-bar-menu_>_&]:[border:0] flex flex-col w-full min-w-0 gap-3.5 p-[12px_14px_14px] [border:0] [border-radius:0] bg-transparent"
              role="group"
              aria-label={t('Model and effort controls')}
            >
              <div className="model-bar-summary [&_.model-bar-mode]:[border:0] [&_.model-bar-mode]:text-muted-foreground [&_.model-bar-mode]:flex-none [&_.model-bar-mode]:w-6 [&_.model-bar-mode]:h-6 [&_.model-bar-mode]:min-h-6 [&_.model-bar-mode]:p-0 [&_.model-bar-mode]:rounded-(--radius-s) [&_.model-bar-mode[aria-pressed='true']]:bg-accent [&_.model-bar-mode[aria-pressed='true']]:text-foreground [&_.model-bar-fast[aria-pressed='true']]:text-brand [&_.model-bar-fast]:w-7 [&_.model-bar-fast]:h-7 [&_.model-bar-fast]:rounded-(--radius-s) grid items-center [grid-template-columns:auto_minmax(0,_1fr)_auto] gap-1.5 min-h-7">
                {fastSupported && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center model-bar-mode model-bar-fast"
                    disabled={disabled}
                    aria-label={t('Codex fast mode')}
                    aria-pressed={fast}
                    title={
                      fast
                        ? t('Fast mode on · Higher usage · Apply on send')
                        : t('Enable Fast mode · Higher usage · Apply on send')
                    }
                    onClick={() => change({ ...settings, serviceTier: fast ? 'standard' : 'fast' })}
                  >
                    <Zap size={15} />
                  </Button>
                )}
                <div className="model-bar-title [&_strong]:min-w-0 [&_strong]:overflow-hidden [&_strong]:text-ellipsis [&_strong]:whitespace-nowrap [&_strong]:text-foreground [&_strong]:text-chat [&_strong]:font-semibold flex items-center min-w-0 justify-start flex-nowrap gap-1">
                  <Button
                    variant="secondary"
                    disabled={disabled}
                    className="bg-fill hover:bg-fill-hover model-bar-model-name [&_>_svg]:flex-none [&_>_svg]:text-muted-foreground [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:text-foreground min-w-0 [border:0] bg-transparent p-0 gap-1 flex items-center"
                    aria-label={t('Select model · {0}', { '0': modelName })}
                    onClick={() => setPicker('model')}
                  >
                    <strong>{modelName}</strong>
                    <ChevronRight size={13} />
                  </Button>
                  {(efforts.length > 0 || shown.provider === 'codex') && (
                    <Button
                      variant="secondary"
                      disabled={disabled}
                      className="bg-fill hover:bg-fill-hover model-bar-effort-name [&:hover:not(:disabled)]:[border:0] [&:hover:not(:disabled)]:bg-transparent [&:hover:not(:disabled)]:text-foreground min-w-0 [border:0] bg-transparent p-0 gap-1 flex-none text-muted-foreground text-control"
                      aria-label={t('Reasoning and service tier')}
                      onClick={() => setPicker('effort')}
                    >
                      {effortName}
                    </Button>
                  )}
                </div>
                <div
                  className="model-bar-actions [&_.model-bar-mode]:w-6 [&_.model-bar-mode]:h-6 [&_.model-bar-mode]:min-h-6 [&_.model-bar-mode]:p-0 [&_.model-bar-mode]:rounded-(--radius-s) flex items-center gap-1"
                  role="group"
                  aria-label={t('Model bar actions')}
                >
                  <div
                    className="model-bar-mode-switch flex items-center p-0.5 gap-0.5 [border:1px_solid_transparent] rounded-(--radius-s) [background:var(--field)]"
                    role="group"
                    aria-label={t('Slider mode')}
                  >
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center model-bar-mode"
                      aria-label={t('Effort only')}
                      aria-pressed={mode === 'effort'}
                      title={t('Effort only · Keep the current model')}
                      onClick={() => setMode('effort')}
                    >
                      <Gauge size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={disabled}
                      className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center model-bar-mode"
                      aria-label={t('Model and effort')}
                      aria-pressed={mode === 'model'}
                      title={t('Model + effort · Use the configured steps')}
                      onClick={() => setMode('model')}
                    >
                      <SlidersHorizontal size={14} />
                    </Button>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={disabled}
                    className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center model-bar-mode"
                    aria-label={t('Model set settings')}
                    title={t('Model set settings')}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('ramu:settings', { detail: { section: 'models', target: 'Model sets' } }),
                      )
                    }
                  >
                    <Settings size={14} />
                  </Button>
                </div>
              </div>
              <div
                className="model-bar-track [&_input]:relative [&_input]:z-1 [&_input]:block [&_input]:[appearance:none] [&_input]:w-full [&_input]:h-[18px] [&_input]:p-0 [&_input]:m-0 [&_input]:[border:0] [&_input]:bg-transparent [&_input]:cursor-pointer [&_input::-webkit-slider-runnable-track]:h-[18px] [&_input::-webkit-slider-runnable-track]:bg-transparent [&_input::-webkit-slider-thumb]:[appearance:none] [&_input::-webkit-slider-thumb]:w-6 [&_input::-webkit-slider-thumb]:h-6 [&_input::-webkit-slider-thumb]:mt-[-3px] [&_input::-webkit-slider-thumb]:rounded-full [&_input::-webkit-slider-thumb]:[background:var(--text)] [&_input::-webkit-slider-thumb]:[border:1px_solid_rgba(0,0,0,.12)] [&_input::-webkit-slider-thumb]:[box-shadow:0_1px_3px_rgba(0,0,0,.2)] [&_[data-slot='slider']]:relative [&_[data-slot='slider']]:h-8 [&_[data-slot='slider']]:z-2 [&_[data-slot='slider-track']]:h-8 [&_[data-slot='slider-track']]:bg-transparent [&_[data-slot='slider-range']]:bg-transparent [&_[data-slot='slider-thumb']]:w-7 [&_[data-slot='slider-thumb']]:h-7 [&_[data-slot='slider-thumb']]:[background:#fff] [&_[data-slot='slider-thumb']]:[border:0] [&_[data-slot='slider-thumb']]:[box-shadow:0_1px_4px_rgba(0,_0,_0,_0.45),_0_0_0_1px_rgba(0,_0,_0,_0.08)] [&_[data-slot='slider-thumb']]:[transition:inset-inline-start_160ms_var(--ease),_box-shadow_120ms_var(--ease)] [&::before]:[content:''] [&::before]:absolute [&::before]:left-0 [&::before]:top-[3px] [&::before]:h-[26px] [&::before]:rounded-full [&::before]:right-0 [&::before]:[background:rgb(var(--ink)_/_0.12)] [&::after]:[content:''] [&::after]:absolute [&::after]:left-0 [&::after]:top-[3px] [&::after]:h-[26px] [&::after]:rounded-full [&::after]:w-[var(--bar-fill)] [&::after]:[background:var(--primary)] [&::after]:[transition:width_160ms_var(--ease)] [&_[data-slot='slider-thumb']:focus-visible]:[outline:2px_solid_var(--line-strong)] [&_[data-slot='slider-thumb']:focus-visible]:[outline-offset:2px] [&_[data-slot='slider']:not([data-slider-ready])_[data-slot='slider-thumb']]:[transition:none] relative h-8 m-[2px_2px_0] [border-radius:0] bg-transparent [box-shadow:none]"
                style={{ '--bar-fill': `calc(${fraction * 100}% + ${14 - 28 * fraction}px)` } as CSSProperties}
              >
                <div
                  className="model-bar-dots [&_span]:rounded-full [&_span]:w-1 [&_span]:h-1 [&_span]:[background:rgb(var(--ink)_/_0.5)] [&_span.unavailable]:[opacity:0.25] absolute flex items-center justify-between pointer-events-none inset-[0_14px] z-1"
                  aria-hidden="true"
                >
                  {Array.from({ length: count }, (_, position) => (
                    <span key={position} className={available(position) ? '' : 'unavailable'} />
                  ))}
                </div>
                <StepSlider
                  thumbLabel={mode === 'effort' ? 'Reasoning effort level' : 'Model set step'}
                  valueText={selectedText}
                  min={0}
                  max={Math.max(1, count - 1)}
                  step={1}
                  value={Math.max(0, index)}
                  disabled={disabled || count < 2}
                  onKeyDown={(event) => event.stopPropagation()}
                  onValueChange={(next) => {
                    const position = typeof next === 'number' ? next : next[0]
                    if (position !== undefined) setDrag(settingsFor(position) ?? null)
                  }}
                  onValueCommitted={(next) => {
                    const position = typeof next === 'number' ? next : next[0]
                    setDrag(null)
                    if (position !== undefined) choose(position)
                  }}
                />
              </div>
            </div>
          )
        }
      />
      {pending && running && (
        <span
          className="inline-flex flex-wrap items-center gap-1 text-caption text-muted-foreground"
          data-model-countdown
        >
          <span className="inline-flex items-center gap-1.5 px-1 tabular-nums" role="status">
            <Clock3 size={13} aria-hidden="true" />
            {t('Applying model in {0}s', { 0: seconds })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            className="small gap-1.5 rounded-(--radius-s) px-2 text-caption text-soft"
            aria-label={t('Apply model change now')}
            onClick={applyPending}
          >
            <Check className="size-3.5" aria-hidden="true" />
            {t('Apply now')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="ghost small gap-1.5 rounded-(--radius-s) border-transparent bg-transparent px-2 text-caption text-muted-foreground hover:bg-hover hover:text-foreground"
            aria-label={t('Cancel model change')}
            onClick={clearPending}
          >
            <X className="size-3.5" aria-hidden="true" />
            {t('Cancel')}
          </Button>
        </span>
      )}
    </>
  )
}
