import { DragHandle } from '@/components/drag-handle'
import { SettingsField, SettingTitleHosts, useSettingsInvoke } from './SettingsScope'
import { SettingsGroupTitle, SettingsRow, SettingsTitle } from '@/components/settings-row'
import { errorText } from '../lib/errors'
import { limitChoiceOf, limitChoiceSwitches } from '@ramu/shared/chat/limitPolicy'
import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import { t, useLanguage } from '../i18n'
import { Button } from '@/components/desktop-button'
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
import { providerName } from '@ramu/shared/providers/providers'
import { useAppSettings } from './AppSettings'
import { Dropdown } from '../Menu'
import { effortDisplayName, useModelSets } from '../models/ModelSets'
import { missingModelOption, modelOption } from '../models/modelOptions'
import { Combobox } from '@/components/combobox'
import { peakUsage, usageTone, useUsage } from './Usage'
import { defaultOrder } from '@ramu/shared/providers/routing'

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
  disabled,
}: {
  label: string
  step: FallbackStep | null
  onChange: (step: FallbackStep) => void
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
  // No step yet leaves the picker empty, showing its placeholder.
  const key = step ? `${step.provider}:${step.model}` : ''
  const { visibleModels } = useAppSettings().preferences
  const options = models
    .filter((entry) => isModelListed(visibleModels, entry) || `${entry.provider}:${entry.id}` === key)
    .map((entry) => modelOption(entry, `${entry.provider}:${entry.id}`))
  if (step && !options.some((option) => option.value === key))
    options.unshift(missingModelOption(step.provider, step.model, key))
  const fast = !!model?.serviceTiers?.some((tier) => tier === 'fast' || tier === 'priority')
  return (
    <div
      className={`fallback-step-picker [&.with-tier]:[grid-template-columns:minmax(0,_1.6fr)_minmax(0,_1fr)_minmax(0,_0.8fr)] [&_.dropdown-trigger]:w-full [&_.dropdown-trigger]:min-w-0 grid [grid-template-columns:minmax(0,_1.6fr)_minmax(0,_1fr)] gap-2 min-w-0${step && fast ? ' with-tier' : ''}`}
    >
      <Combobox
        label={t('{0} model', { '0': label })}
        searchPlaceholder={t('Search models')}
        emptyText={t('No matching models')}
        value={key}
        options={options}
        disabled={disabled}
        onChange={(value) => {
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
  setting,
  chain,
  onChange,
  onCopy,
  disabled,
}: {
  title: string
  /** The setting this order is, so its title shows where it stands on each host. */
  setting: string
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
        <SettingTitleHosts path={setting} />
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
          <SettingsTitle>{t('When to switch')}</SettingsTitle>
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
          setting="fallback.order"
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
        <SettingsTitle>{t('Decide before Codex starts its own sub-agents')}</SettingsTitle>
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

/** Settings › Sub-agents: one choice of model for the helpers an agent starts. Limits follow the thread's own fallback. */
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
  const sub = value.subagents
  const set = (patch: Partial<SubagentPreferences>) => onChange({ ...value, subagents: { ...sub, ...patch } })
  const firstStep = (): FallbackStep | null => {
    const model = catalogs.flatMap((catalog) => catalog.models).find((entry) => entry.isDefault)
    return model ? stepFor(model) : null
  }
  return (
    <div className="settings-form [&_p]:m-[0_0_8px] [&_>_p.muted]:m-[12px_0] [&_>_p.muted]:leading-[1.55] flex flex-col gap-0 subagent-settings mt-8">
      <SettingsGroupTitle>{t('Sub-agents')}</SettingsGroupTitle>
      <SettingsRow setting="subagents.model" className="">
        <span>
          <SettingsTitle>{t('Helpers use')}</SettingsTitle>
          <span className="muted text-muted-foreground block block small text-caption">
            {sub.model === 'auto'
              ? t(
                  "Ramu runs each helper on the thread's provider, with the model and effort that provider picks for its task.",
                )
              : sub.model === 'pick'
                ? t('Every helper runs on the model below.')
                : t("Each provider's own helpers, on the thread's model.")}{' '}
            {t("At a usage limit, helpers follow the thread's fallback.")}
          </span>
        </span>
        <Dropdown
          label={t('Helpers use')}
          value={sub.model}
          disabled={busy}
          options={[
            { value: 'thread', label: t("The thread's model") },
            { value: 'auto', label: t('A model chosen for each task') },
            { value: 'pick', label: t('A model I pick') },
          ]}
          onChange={(model) =>
            set({
              model: model === 'auto' ? 'auto' : model === 'pick' ? 'pick' : 'thread',
              ...(model === 'pick' && !sub.step ? { step: firstStep() } : {}),
            })
          }
        />
      </SettingsRow>
      {sub.model === 'pick' && (
        <SettingsRow
          setting="subagents.step"
          className="subagent-route [&_.fallback-step-picker]:flex-1 [&_.fallback-step-picker]:max-w-[460px] items-center"
        >
          <span>
            <strong>{t('All sub-agents use')}</strong>
          </span>
          <StepPicker label={t('All sub-agents')} step={sub.step} disabled={busy} onChange={(step) => set({ step })} />
        </SettingsRow>
      )}
      <CodexHookRow checked={sub.codexHook} busy={busy} onChange={(checked) => set({ codexHook: checked })} />
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
        {t('Ask a second model before key decisions or when the agent is stuck.')}
      </p>
      <SettingsRow setting="advisor.enabled" className="settings-toggle">
        <span>
          <SettingsTitle>{t('Advisor')}</SettingsTitle>
          <span className="muted text-muted-foreground block block small text-caption">
            {t(
              'Sends the thread transcript to the advisor model and uses model tokens. Applies when a thread starts or restarts.',
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
          <SettingsTitle>{t('Always wait for advice')}</SettingsTitle>
          <span className="muted text-muted-foreground block block small text-caption">
            {t('Pause until advice arrives. When off, the agent keeps working on other things.')}
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
