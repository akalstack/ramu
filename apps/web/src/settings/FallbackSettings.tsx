import { DragHandle } from '@/components/drag-handle'
import { SubagentSelectionSettings } from './SubagentSelectionSettings'
import { SettingsField, useSettingsInvoke } from './SettingsScope'
import { SettingsGroupTitle, SettingsRow } from '@/components/settings-row'
import { errorText } from '../lib/errors'
import { limitChoiceOf, limitChoiceSwitches } from '@ramu/shared/chat/limitPolicy'
import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import { t, useLanguage } from '../i18n'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useState, type ReactNode } from 'react'
import type {
  AdvisorPreferences,
  AgentModel,
  AgentProvider,
  AppPreferences,
  FallbackStep,
  SubagentPreferences,
  SwitchThreshold,
  UsageReading,
} from '@ramu/shared/types'
import { providerEnabled, providerName } from '@ramu/shared/providers/providers'
import { useAppSettings } from './AppSettings'
import { Dropdown } from '../Menu'
import { effortDisplayName, modelDisplayName, useModelSets } from '../models/ModelSets'
import { ProviderIcon } from '../models/ProviderIcon'
import { peakUsage, usageTone, useUsage } from './Usage'
import { defaultOrder } from '@ramu/shared/providers/routing'

const NATIVE = '__native'
const newId = () => crypto.randomUUID()

function stepFor(model: AgentModel, previous?: FallbackStep | null): FallbackStep {
  return {
    id: previous?.id ?? newId(),
    provider: model.provider,
    model: model.id,
    effort: previous?.effort && model.efforts.includes(previous.effort) ? previous.effort : model.defaultEffort,
    serviceTier: model.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
      ? (previous?.serviceTier ?? 'standard')
      : 'standard',
  }
}

function UsageHint({ provider, usage }: { provider: AgentProvider; usage: UsageReading[] }) {
  useLanguage()
  const peak = peakUsage(usage, provider)
  // One width for every row, reading or not, so "Limited" does not narrow its row's pickers beside a "64%".
  return (
    <span
      className={`fallback-usage [&.warn]:text-warn [&.bad]:text-bad w-16 flex-none truncate text-right text-caption tabular-nums text-muted-foreground ${peak ? usageTone(peak) : ''}`}
      title={peak ? t('Highest usage window for {0}', { '0': providerName(provider) }) : undefined}
    >
      {peak ? (peak.status === 'limited' ? t('Limited') : `${peak.usedPercent}%`) : ''}
    </span>
  )
}

/** Model, effort and (for Codex) speed for one step, built from the installed providers' catalogues. */
function StepPicker({
  label,
  step,
  onChange,
  allowNative = false,
  disabled,
}: {
  label: string
  step: FallbackStep | null
  onChange: (step: FallbackStep | null) => void
  allowNative?: boolean
  disabled?: boolean
}) {
  useLanguage()
  const { catalogs } = useModelSets()
  const models = catalogs.flatMap((catalog) => catalog.models)
  const model = step
    ? models.find(
        (entry) => entry.provider === step.provider && (entry.id === step.model || (!step.model && entry.isDefault)),
      )
    : undefined
  const key = step ? `${step.provider}:${step.model}` : NATIVE
  const { visibleModels } = useAppSettings().preferences
  const options = [
    ...(allowNative ? [{ value: NATIVE, label: t('Native') }] : []),
    ...models
      .filter((entry) => isModelListed(visibleModels, entry) || `${entry.provider}:${entry.id}` === key)
      .map((entry) => ({
        value: `${entry.provider}:${entry.id}`,
        label: `${modelDisplayName(entry.name)} · ${providerName(entry.provider)}`,
      })),
  ]
  if (step && !options.some((option) => option.value === key))
    options.unshift({
      value: key,
      label: step.model
        ? t('{0} · Unavailable', { '0': step.model })
        : t('{0} default', { '0': providerName(step.provider) }),
    })
  const fast = !!model?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  return (
    <div
      className={`fallback-step-picker [&.with-tier]:[grid-template-columns:minmax(0,_1.6fr)_minmax(0,_1fr)_minmax(0,_0.8fr)] [&_.dropdown-trigger]:w-full [&_.dropdown-trigger]:min-w-0 grid [grid-template-columns:minmax(0,_1.6fr)_minmax(0,_1fr)] gap-2 min-w-0${step && fast ? ' with-tier' : ''}`}
    >
      <Dropdown
        label={t('{0} model', { '0': label })}
        value={key}
        options={options}
        disabled={disabled}
        onChange={(value) => {
          if (value === NATIVE) return onChange(null)
          const entry = models.find((m) => `${m.provider}:${m.id}` === value)
          if (entry) onChange(stepFor(entry, step))
        }}
      />
      {step && !!model?.efforts.length && (
        <Dropdown
          label={t('{0} effort', { '0': label })}
          value={step.effort ?? model?.defaultEffort ?? ''}
          disabled={disabled || !model?.efforts.length}
          options={[
            ...(model?.efforts ?? []).map((effort) => ({
              value: effort,
              label: effortDisplayName(effort, step.provider),
            })),
          ]}
          onChange={(effort) => onChange({ ...step, effort: model?.efforts.find((entry) => entry === effort) ?? null })}
        />
      )}
      {step && fast && (
        <Dropdown
          label={t('{0} speed', { '0': label })}
          value={step.serviceTier ?? 'standard'}
          disabled={disabled}
          options={[
            { value: 'standard', label: t('Standard') },
            { value: 'fast', label: t('Fast') },
          ]}
          onChange={(tier) => onChange({ ...step, serviceTier: tier === 'fast' ? 'fast' : 'standard' })}
        />
      )}
    </div>
  )
}

/** One draggable row of an order list; the grip is the drag handle. */
function SortableRow({
  id,
  index,
  disabled,
  children,
}: {
  id: string
  index: number
  disabled?: boolean
  children: ReactNode
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      className="fallback-row [&_.fallback-step-picker]:flex-1 flex items-center gap-2 relative"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <DragHandle
        ref={setActivatorNodeRef}
        aria-label={t('Drag fallback {0} to reorder', { '0': index + 1 })}
        title={t('Drag to reorder')}
        disabled={disabled}
        {...attributes}
        {...listeners}
      />
      {children}
    </div>
  )
}

/** Models ranked best first: chats use the highest one with room. */
function OrderEditor({
  title,
  chain,
  onChange,
  onCopy,
  disabled,
}: {
  title: string
  chain: FallbackStep[]
  onChange: (chain: FallbackStep[]) => void
  onCopy?: () => void
  disabled?: boolean
}) {
  useLanguage()
  const usage = useUsage()
  const { catalogs } = useModelSets()
  const move = (index: number, delta: number) => {
    const next = [...chain]
    const [moved] = next.splice(index, 1)
    next.splice(index + delta, 0, moved!)
    onChange(next)
  }
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const drop = (event: DragEndEvent) => {
    const from = chain.findIndex((step) => step.id === event.active.id),
      to = chain.findIndex((step) => step.id === event.over?.id)
    if (from >= 0 && to >= 0 && from !== to) onChange(arrayMove(chain, from, to))
  }
  const add = () => {
    const used = new Set(chain.map((step) => `${step.provider}:${step.model}`))
    const model =
      catalogs.flatMap((catalog) => catalog.models).find((entry) => !used.has(`${entry.provider}:${entry.id}`)) ??
      catalogs.flatMap((catalog) => catalog.models)[0]
    if (model) onChange([...chain, stepFor(model)])
  }
  return (
    <section className="fallback-chain [&_+_.fallback-chain]:mt-2 mb-6 flex flex-col gap-1.5 p-[10px_12px] [border:1px_solid_transparent] rounded-(--radius-m) bg-fill">
      <header className="fallback-chain-heading [&_strong]:text-foreground flex items-center gap-[7px] min-h-[26px] text-soft text-control">
        <strong>{title}</strong>
        <span className="grow flex-1 min-w-0 text-left" />
        {onCopy && (
          <Button
            variant="ghost"
            size="sm"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption"
            disabled={disabled}
            onClick={onCopy}
          >
            <Copy size={12} />
            {t('Copy from main')}
          </Button>
        )}
      </header>
      {chain.length < 2 && (
        <p className="muted text-muted-foreground small text-caption fallback-empty m-0">
          {t('Add at least two models. With one, the thread waits at the limit.')}
        </p>
      )}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={drop}>
        <SortableContext items={chain.map((step) => step.id)} strategy={verticalListSortingStrategy}>
          {chain.map((step, index) => (
            <SortableRow key={step.id} id={step.id} index={index} disabled={disabled || chain.length < 2}>
              <span className="settings-step-number w-[18px] flex-none text-muted-foreground text-caption text-center">
                {index + 1}
              </span>
              <StepPicker
                label={t('Model {0}', { '0': index + 1 })}
                step={step}
                disabled={disabled}
                onChange={(next) => next && onChange(chain.map((entry) => (entry.id === step.id ? next : entry)))}
              />
              <UsageHint provider={step.provider} usage={usage} />
              <span className="settings-step-actions flex gap-0.5">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                  aria-label={t('Move fallback {0} up', { '0': index + 1 })}
                  title={t('Move up')}
                  disabled={disabled || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                  aria-label={t('Move fallback {0} down', { '0': index + 1 })}
                  title={t('Move down')}
                  disabled={disabled || index === chain.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={13} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
                  aria-label={t('Remove fallback {0}', { '0': index + 1 })}
                  title={t('Remove')}
                  disabled={disabled}
                  onClick={() => onChange(chain.filter((entry) => entry.id !== step.id))}
                >
                  <Trash2 size={13} />
                </Button>
              </span>
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
      <Button
        variant="ghost"
        size="sm"
        className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover small text-caption fallback-add mt-1 -ml-2 self-start gap-1.5 text-soft"
        disabled={disabled || chain.length >= 10}
        onClick={add}
      >
        <Plus size={13} />
        {t('Add fallback')}
      </Button>
    </section>
  )
}

const THRESHOLDS: { value: string; label: string }[] = [
  { value: '80', label: 'At 80%' },
  { value: '90', label: 'At 90%' },
  { value: '95', label: 'At 95%' },
  { value: 'limit', label: 'Only at the limit' },
]
const toThreshold = (value: string): SwitchThreshold =>
  value === '80' ? 80 : value === '90' ? 90 : value === '95' ? 95 : null
const fromThreshold = (value: SwitchThreshold) => (value === null ? 'limit' : String(value))

/** Providers that can be configured: everything with a catalogue, Claude and Codex first. */
function useProviders(): AgentProvider[] {
  useLanguage()
  const { catalogs } = useModelSets()
  const { preferences } = useAppSettings()
  const installed = catalogs.filter((catalog) => catalog.models.length).map((catalog) => catalog.provider)
  return (['claude-code', 'codex', 'opencode', 'cursor', 'antigravity'] as AgentProvider[]).filter(
    (provider) =>
      providerEnabled(preferences.providerBinaries, provider) &&
      (installed.includes(provider) || provider === 'claude-code' || provider === 'codex'),
  )
}

/** Settings › Access & Fallback: when to switch, and the ranked model order. */
export function FallbackSettings({
  value,
  onChange,
  busy,
}: {
  value: AppPreferences
  onChange: (next: AppPreferences) => void
  busy: boolean
}) {
  useLanguage()
  const { catalogs } = useModelSets()
  const fallback = value.fallback
  const set = (patch: Partial<AppPreferences['fallback']>) =>
    onChange({ ...value, fallback: { ...fallback, ...patch } })
  // Only "Switch to another model" (or the hidden switch-then-stop combination) uses these.
  const off = !limitChoiceSwitches(limitChoiceOf(value))
  return (
    <>
      <SettingsRow setting="fallback.switchAt" className="">
        <span>
          <strong>{t('When to switch')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Switch at a usage limit, or earlier at the selected percentage.')}
          </span>
        </span>
        <Dropdown
          label={t('When to switch')}
          value={fromThreshold(fallback.switchAt)}
          options={THRESHOLDS}
          disabled={busy || off}
          onChange={(next) => set({ switchAt: toThreshold(next) })}
        />
      </SettingsRow>
      <div className="settings-intro mb-3">
        <h4>{t('Fallback order')}</h4>
        <p className="muted text-muted-foreground small text-caption">
          {t(
            'Put your best model first. Threads use the highest model with room, move down when it runs out, and move back up once a higher one has room again.',
          )}
        </p>
      </div>
      <SettingsField path="fallback.order">
        <OrderEditor
          title={t('Best first')}
          disabled={busy || off}
          chain={fallback.order ?? defaultOrder(catalogs)}
          onChange={(order) => set({ order })}
        />
      </SettingsField>
    </>
  )
}

/**
 * Codex fixes its own sub-agent tools when a chat starts. A hook lets Ramu decide each time instead, which needs one
 * trust entry for the hook in Codex's own config; turning this on writes it, and says so first.
 */
function CodexHookRow({
  checked,
  busy,
  onChange,
}: {
  checked: boolean
  busy: boolean
  onChange: (checked: boolean) => void
}) {
  const invoke = useSettingsInvoke()
  useLanguage()
  const [status, setStatus] = useState<{ trusted: boolean; error?: string } | null>(null)
  const [working, setWorking] = useState(false)
  useEffect(() => {
    void invoke('codex.hook.status').then(setStatus, () => setStatus({ trusted: false }))
  }, [invoke])
  const toggle = async (next: boolean) => {
    if (!next) return onChange(false)
    setWorking(true)
    try {
      const result = await invoke('codex.hook.trust')
      setStatus(result)
      if (result.trusted) onChange(true)
    } catch (error) {
      setStatus({ trusted: false, error: errorText(error) })
    } finally {
      setWorking(false)
    }
  }
  return (
    <SettingsRow setting="subagents.codexHook" className="settings-toggle">
      <span>
        <strong>{t('Decide before Codex starts its own sub-agents')}</strong>
        <span className="muted text-muted-foreground block block small text-caption">
          {t('Route Codex sub-agents before they start. Enabling adds a trusted hook to ')}
          <code>~/.codex/config.toml</code>
          {t('. Disabling leaves the inactive entry in place.')}
        </span>
        {status && (
          <span
            className={`block block small text-caption ${status.error ? 'error text-bad' : 'muted text-muted-foreground'}`}
          >
            {status.error
              ? `Codex: ${status.error}`
              : status.trusted
                ? t('Codex trusts the hook.')
                : t('Codex does not trust the hook yet.')}
          </span>
        )}
      </span>
      <Switch
        aria-label={t('Decide before Codex starts its own sub-agents')}
        checked={checked}
        disabled={busy || working}
        onCheckedChange={(next) => void toggle(next)}
      />
    </SettingsRow>
  )
}

/** Settings › Sub-agents: where sub-agents run, and how they fall back. */
export function SubagentSettings({
  value,
  onChange,
  busy,
}: {
  value: AppPreferences
  onChange: (next: AppPreferences) => void
  busy: boolean
}) {
  useLanguage()
  const { catalogs } = useModelSets()
  const providers = useProviders()
  const sub = value.subagents
  const set = (patch: Partial<SubagentPreferences>) => onChange({ ...value, subagents: { ...sub, ...patch } })
  const firstStep = (): FallbackStep | null => {
    const model = catalogs.flatMap((catalog) => catalog.models).find((entry) => entry.isDefault)
    return model ? stepFor(model) : null
  }
  const mainOrder = () => value.fallback.order ?? defaultOrder(catalogs)
  const toggle = (key: 'continueNative' | 'isolate' | 'shareContext', title: string, description: string) => (
    <SettingsRow setting={`subagents.${key}`} className="settings-toggle">
      <span>
        <strong>{title}</strong>
        <span className="muted text-muted-foreground block block small text-caption">{description}</span>
      </span>
      <Switch
        aria-label={title}
        checked={sub[key]}
        disabled={busy}
        onCheckedChange={(checked) => set({ [key]: checked })}
      />
    </SettingsRow>
  )
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 subagent-settings mt-8">
      <SettingsGroupTitle>{t('Sub-agents')}</SettingsGroupTitle>
      <p className="muted text-muted-foreground small text-caption">
        {t('Choose where sub-agents run and how they handle usage limits.')}
      </p>
      <SettingsRow setting="subagents.mode" className="">
        <span>
          <strong>{t('Where sub-agents run')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Use native sub-agents or route tasks to a selected model.')}
          </span>
        </span>
        <Dropdown
          label={t('Where sub-agents run')}
          value={sub.mode}
          disabled={busy}
          options={[
            { value: 'native', label: t('Native') },
            { value: 'single', label: t('One provider for all') },
            { value: 'per-provider', label: t('Per provider') },
          ]}
          onChange={(mode) =>
            set({
              mode: mode === 'single' ? 'single' : mode === 'per-provider' ? 'per-provider' : 'native',
              ...(mode === 'single' && !sub.single ? { single: firstStep() } : {}),
            })
          }
        />
      </SettingsRow>
      {sub.mode === 'single' && (
        <SettingsRow
          setting="subagents.single"
          className="subagent-route [&_.fallback-step-picker]:flex-1 [&_.fallback-step-picker]:max-w-[460px] items-center"
        >
          <span>
            <strong>{t('All sub-agents use')}</strong>
          </span>
          <StepPicker
            label={t('All sub-agents')}
            step={sub.single}
            disabled={busy}
            onChange={(step) => set({ single: step })}
          />
        </SettingsRow>
      )}
      {sub.mode === 'per-provider' && (
        <div className="subagent-routes flex flex-col">
          {providers.map((provider) => (
            <SettingsRow
              setting={`subagents.perProvider.${provider}`}
              className="subagent-route [&_.fallback-step-picker]:flex-1 [&_.fallback-step-picker]:max-w-[460px] items-center"
              key={provider}
            >
              <span className="subagent-route-label inline-flex items-center gap-[7px] whitespace-nowrap">
                <ProviderIcon provider={provider} size={14} />
                {t('When ')}
                <strong>{providerName(provider)}</strong> {t(' starts one')}
              </span>
              <StepPicker
                label={t('{0} sub-agents', { '0': providerName(provider) })}
                allowNative
                step={sub.perProvider[provider] ?? null}
                disabled={busy}
                onChange={(step) => set({ perProvider: { ...sub.perProvider, [provider]: step } })}
              />
            </SettingsRow>
          ))}
        </div>
      )}
      <SubagentSelectionSettings value={sub} onChange={set} busy={busy} />
      <div className="settings-intro">
        <h4>{t('By type')}</h4>
        <p className="muted text-muted-foreground small text-caption">
          {t('Override routing for matching task types, such as Explore or Plan.')}
        </p>
      </div>
      {!sub.byType.length && (
        <p className="muted m-0 mb-1 rounded-(--radius-m) bg-fill px-4 py-3 text-control text-muted-foreground">
          {t('No type rules yet. Every sub-agent uses the routing above.')}
        </p>
      )}
      {sub.byType.map((rule) => (
        <SettingsRow
          setting="subagents.byType"
          className="subagent-route [&_.fallback-step-picker]:flex-1 [&_.fallback-step-picker]:max-w-[460px] items-center"
          key={rule.id}
        >
          <Input
            aria-label={t('Sub-agent type')}
            placeholder={t('Type, e.g. Explore')}
            value={rule.type}
            maxLength={80}
            disabled={busy}
            className="subagent-type w-[160px] flex-none"
            onChange={(event) =>
              set({
                byType: sub.byType.map((entry) =>
                  entry.id === rule.id ? { ...entry, type: event.target.value } : entry,
                ),
              })
            }
          />
          <StepPicker
            label={t('{0} sub-agents', { '0': rule.type || 'Type' })}
            allowNative
            step={rule.step}
            disabled={busy}
            onChange={(step) =>
              set({ byType: sub.byType.map((entry) => (entry.id === rule.id ? { ...entry, step } : entry)) })
            }
          />
          <Button
            variant="ghost"
            size="icon-xs"
            className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)"
            aria-label={t('Remove {0} rule', { '0': rule.type || 'type' })}
            title={t('Remove')}
            disabled={busy}
            onClick={() => set({ byType: sub.byType.filter((entry) => entry.id !== rule.id) })}
          >
            <Trash2 size={13} />
          </Button>
        </SettingsRow>
      ))}
      <Button
        variant="ghost"
        size="sm"
        className="fallback-add mb-6 mt-2 h-10 w-full justify-center gap-1.5 rounded-(--radius-m) border border-dashed border-line bg-transparent text-control text-muted-foreground hover:border-solid hover:bg-hover hover:text-foreground"
        disabled={busy || sub.byType.length >= 20}
        onClick={() => set({ byType: [...sub.byType, { id: newId(), type: '', step: firstStep() }] })}
      >
        <Plus size={13} />
        {t('Add type rule')}
      </Button>

      <div className="settings-intro">
        <h4>{t('When a sub-agent is limited')}</h4>
      </div>
      <SettingsRow setting="subagents.fallback" className="">
        <span>
          <strong>{t('Fallback order')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Use the main order or a separate one for sub-agents. Sub-agents only move down when they run out.')}
          </span>
        </span>
        <Dropdown
          label={t('Sub-agent fallback order')}
          value={sub.fallback}
          disabled={busy}
          options={[
            { value: 'same', label: t('Same as main') },
            { value: 'separate', label: t('Separate list') },
          ]}
          onChange={(next) => set({ fallback: next === 'separate' ? 'separate' : 'same' })}
        />
      </SettingsRow>
      <SettingsRow setting="subagents.switchAt" className="">
        <span>
          <strong>{t('Switch sub-agents')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Choose when sub-agents switch to their fallback model.')}
          </span>
        </span>
        <Dropdown
          label={t('Switch sub-agents')}
          value={sub.switchAt === 'same' ? 'same' : fromThreshold(sub.switchAt)}
          disabled={busy}
          options={[{ value: 'same', label: t('Same as main') }, ...THRESHOLDS]}
          onChange={(next) => set({ switchAt: next === 'same' ? 'same' : toThreshold(next) })}
        />
      </SettingsRow>
      {sub.fallback === 'separate' && (
        <SettingsField path="subagents.order">
          <OrderEditor
            title={t('Sub-agents, best first')}
            disabled={busy}
            chain={sub.order ?? mainOrder()}
            onChange={(order) => set({ order })}
            onCopy={() => set({ order: mainOrder().map((step) => ({ ...step, id: newId() })) })}
          />
        </SettingsField>
      )}
      <CodexHookRow checked={sub.codexHook} busy={busy} onChange={(checked) => set({ codexHook: checked })} />
      {toggle(
        'continueNative',
        'Continue limited native sub-agents',
        "When a provider's own sub-agent hits a limit, restart its task on the fallback list with what it had done so far.",
      )}

      <div className="settings-intro">
        <h4>{t('Running')}</h4>
      </div>
      {toggle(
        'isolate',
        'Isolate sub-agents',
        'Run each sub-agent in a separate checkout. Apply its changes back when finished; keep conflicts for review.',
      )}
      {toggle(
        'shareContext',
        'Share thread context',
        "Attach the thread's recent transcript to each sub-agent's task.",
      )}
      <SettingsRow setting="subagents.maxConcurrent" className="">
        <span>
          <strong>{t('At once per thread')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Additional sub-agents wait for an available slot.')}
          </span>
        </span>
        <Dropdown
          label={t('Sub-agents at once per thread')}
          value={String(sub.maxConcurrent)}
          disabled={busy}
          options={Array.from({ length: 8 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))}
          onChange={(next) => set({ maxConcurrent: Number(next) })}
        />
      </SettingsRow>
    </div>
  )
}

/** Settings › Advisor: a model on any provider that main chat agents consult at decision points. */
export function AdvisorSettings({
  value,
  onChange,
  busy,
}: {
  value: AppPreferences
  onChange: (next: AppPreferences) => void
  busy: boolean
}) {
  const invoke = useSettingsInvoke()
  useLanguage()
  const { catalogs } = useModelSets()
  const [claude, setClaude] = useState<string | null>(null)
  useEffect(() => {
    void invoke('advisor.claude').then(
      (status) => setClaude(status.model),
      () => setClaude(null),
    )
  }, [invoke])
  const advisor = value.advisor
  const set = (patch: Partial<AdvisorPreferences>) => onChange({ ...value, advisor: { ...advisor, ...patch } })
  /** Starts from Claude Code's own advisor model when one is set, otherwise the first default model. */
  const firstStep = (): FallbackStep | null => {
    const models = catalogs.flatMap((catalog) => catalog.models)
    const alias = claude?.toLowerCase()
    const model =
      (alias &&
        models.find(
          (entry) =>
            entry.provider === 'claude-code' &&
            (entry.id.toLowerCase() === alias ||
              entry.id.toLowerCase().includes(alias) ||
              entry.name.toLowerCase().includes(alias)),
        )) ||
      models.find((entry) => entry.isDefault) ||
      models[0]
    return model ? stepFor(model) : null
  }
  const toggle = (enabled: boolean) => set({ enabled, ...(enabled && !advisor.step ? { step: firstStep() } : {}) })
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 advisor-settings mt-8">
      <SettingsGroupTitle>{t('Advisor')}</SettingsGroupTitle>
      <p className="muted text-muted-foreground small text-caption">
        {t('Consult a second model before key decisions or when the agent is stuck.')}
      </p>
      <SettingsRow setting="advisor.enabled" className="settings-toggle">
        <span>
          <strong>{t('Advisor')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t(
              'Send the thread transcript to the advisor model. Uses model tokens. Applies when a thread starts or restarts.',
            )}
          </span>
        </span>
        <Switch aria-label={t('Advisor')} checked={advisor.enabled} disabled={busy} onCheckedChange={toggle} />
      </SettingsRow>
      <SettingsRow
        setting="advisor.step"
        className="subagent-route [&_.fallback-step-picker]:flex-1 [&_.fallback-step-picker]:max-w-[460px] items-center"
      >
        <span>
          <strong>{t('Advisor model')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Choose the model used for advice.')}
          </span>
        </span>
        <StepPicker
          label={t('Advisor')}
          step={advisor.step}
          disabled={busy || !advisor.enabled}
          onChange={(step) => set({ step })}
        />
      </SettingsRow>
      <SettingsRow setting="advisor.wait" className="settings-toggle">
        <span>
          <strong>{t('Always wait for advice')}</strong>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Pause until advice arrives. When off, the agent can continue independent work.')}
          </span>
        </span>
        <Switch
          aria-label={t('Always wait for advice')}
          checked={advisor.wait}
          disabled={busy || !advisor.enabled}
          onCheckedChange={(wait) => set({ wait })}
        />
      </SettingsRow>
      {claude && (
        <p className="muted text-muted-foreground small text-caption advisor-claude-note">
          {advisor.enabled
            ? t(
                'Ramu’s advisor replaces Claude’s advisor ({0}) for these threads. Your Claude settings stay unchanged.',
                { '0': claude },
              )
            : t('Claude threads use your configured advisor ({0}) while Ramu’s advisor is off.', { '0': claude })}
        </p>
      )}
    </div>
  )
}
