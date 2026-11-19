import { useEffect, useState, type ReactNode } from 'react'
import { Check, ExternalLink, FolderGit2, Layers, SlidersHorizontal, Wifi } from 'lucide-react'
import { cn } from 'cn'
import { providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import type {
  AgentModel,
  AgentProvider,
  AgentSettings,
  ModelPreferences,
  NetworkStatus,
  Project,
} from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { StepSlider } from '@/components/step-slider'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { accessModes } from '../chat/AgentControls'
import { Dropdown } from '../Menu'
import { invoke, ramu } from '../ipc'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { effortDisplayName, modelDisplayName, modelStepName, useModelSets } from '../models/ModelSets'
import { ProviderIcon } from '../models/ProviderIcon'
import { runProviderCommand } from '../models/ProviderSetupTerminal'
import { useAppSettings } from '../settings/AppSettings'
import { choosableEfforts, initialChoice, onboardingModels, withModel, type DefaultModelChoice } from './defaultModel'
import { FEWEST_TOKENS, TOKEN_FEATURES, sameChoices, type TokenChoices } from './tokenChoices'
import { Group, Row } from './parts'
import { AccountSignIn } from './SignInRows'

export function AgentsStep({
  statuses,
  onRefresh,
  onError,
}: {
  statuses: ProviderStatus[] | null
  onRefresh(): Promise<void>
  onError(message: string): void
}) {
  const [checking, setChecking] = useState(false)
  const signIn = async (status: ProviderStatus) => {
    onError('')
    try {
      const command = await invoke('providers.loginCommand', status.provider)
      if (command) runProviderCommand(`${providerName(status.provider)} · ${t('Sign in')}`, command)
      else await invoke('providers.signIn', status.provider)
    } catch (e) {
      onError(errorText(e))
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {statuses === null ? (
        <p className="m-0 text-caption text-muted-foreground" role="status">
          {t('Looking for installed agents…')}
        </p>
      ) : (
        <Group>
          {statuses.map((status) => (
            <Row
              key={status.provider}
              title={
                <>
                  <ProviderIcon provider={status.provider} size={15} />
                  {providerName(status.provider)}
                </>
              }
              help={
                status.installed
                  ? status.signIn?.default?.signedIn
                    ? t('Signed in')
                    : t('Installed')
                  : t('Not installed')
              }
            >
              {status.installed ? (
                status.signIn?.default?.signedIn ? (
                  <Check size={16} className="text-brand" aria-label={t('Signed in')} />
                ) : (
                  <Button variant="secondary" onClick={() => void signIn(status)}>
                    {t('Sign in')}
                  </Button>
                )
              ) : (
                <Button
                  variant="ghost"
                  onClick={() => void ramu.invoke('app.openExternal', status.docsUrl).catch(() => {})}
                >
                  {t('Setup instructions')}
                  <ExternalLink size={13} />
                </Button>
              )}
            </Row>
          ))}
        </Group>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          disabled={checking}
          onClick={() => {
            setChecking(true)
            void onRefresh().finally(() => setChecking(false))
          }}
        >
          {checking ? t('Checking…') : t('Check again')}
        </Button>
      </div>
    </div>
  )
}

type Mode = NonNullable<ModelPreferences['defaultBarMode']>

/** A selectable card with a live example of the control it chooses. */
function ModeCard({
  selected,
  icon,
  title,
  help,
  onSelect,
  children,
}: {
  selected: boolean
  icon: ReactNode
  title: string
  help: string
  onSelect(): void
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-(--radius-m) bg-fill p-4 ring-1 transition-shadow',
        selected ? 'ring-primary' : 'ring-transparent hover:ring-(--edge)',
      )}
    >
      <RowButton
        role="radio"
        aria-checked={selected}
        onClick={onSelect}
        className="items-start gap-3 p-0 text-foreground hover:bg-transparent"
      >
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <strong className="block font-medium">{title}</strong>
          <span className="mt-0.5 block text-caption leading-[18px] text-muted-foreground">{help}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            'mt-0.5 flex size-4 flex-none items-center justify-center rounded-full border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-(--edge)',
          )}
        >
          {selected && <Check size={11} strokeWidth={3} />}
        </span>
      </RowButton>
      {children}
    </div>
  )
}

/** A working slider over example stops, so the person feels the control before choosing it. */
function Example({ label, stops, caption }: { label: string; stops: string[]; caption?: string }) {
  const [index, setIndex] = useState(Math.floor((stops.length - 1) / 2))
  return (
    <div className="rounded-(--radius-s) bg-(--float-bg) px-3 py-2.5">
      <div className="mb-2 flex items-baseline justify-between gap-2 text-caption">
        <span className="text-muted-foreground">{t('Example')}</span>
        <span className="truncate font-medium text-foreground">
          {caption ? `${caption} · ${stops[index]}` : stops[index]}
        </span>
      </div>
      <StepSlider
        min={0}
        max={Math.max(1, stops.length - 1)}
        step={1}
        value={index}
        thumbLabel={label}
        valueText={stops[index]}
        onValueChange={(value) => setIndex(value as number)}
      />
      <div className="mt-1.5 flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">{stops[0]}</span>
        <span className="truncate text-right">{stops[stops.length - 1]}</span>
      </div>
    </div>
  )
}

export function ModelsStep({
  mode,
  onMode,
  provider,
}: {
  mode: Mode
  onMode(mode: Mode): void
  provider: AgentProvider
}) {
  const { preferences, catalogs } = useModelSets()
  const set = preferences.sets.find((entry) => entry.id === preferences.defaultSetId) ?? preferences.sets[0]
  const stepNames = set && set.steps.length > 1 ? set.steps.map((step) => modelStepName(step, catalogs)) : null
  const model =
    catalogs.find((catalog) => catalog.provider === provider)?.models.find((entry) => entry.isDefault) ??
    catalogs.flatMap((catalog) => catalog.models).find((entry) => entry.isDefault)
  const efforts = model && model.efforts.length > 1 ? model.efforts : null
  return (
    <div role="radiogroup" aria-label={t('Model selection')} className="flex flex-col gap-3">
      <ModeCard
        selected={mode === 'model'}
        icon={<Layers size={16} />}
        title={t('Steps')}
        help={t(
          'One slider moves through saved steps, from a quick, cheap model to a slower, thorough one. Best when you switch models often.',
        )}
        onSelect={() => onMode('model')}
      >
        <Example
          label={t('Example step')}
          stops={stepNames ?? [t('Fast model · Low'), t('Balanced model · Medium'), t('Strongest model · High')]}
        />
      </ModeCard>
      <ModeCard
        selected={mode === 'effort'}
        icon={<SlidersHorizontal size={16} />}
        title={t('Model then effort')}
        help={t(
          'Pick one model, then slide how hard it thinks. Best when you stay on one model and only change the effort.',
        )}
        onSelect={() => onMode('effort')}
      >
        <Example
          label={t('Example effort')}
          caption={model ? modelDisplayName(model.name) : undefined}
          stops={
            efforts
              ? efforts.map((effort) => effortDisplayName(effort, model!.provider))
              : [t('Low'), t('Medium'), t('High')]
          }
        />
      </ModeCard>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Higher steps and effort give better answers on hard work but use more tokens and take longer.')}
      </p>
    </div>
  )
}

/** A radio row: the choice, a short note and the check, as Settings cards show a selection. */
function Choice({
  selected,
  title,
  note,
  onSelect,
}: {
  selected: boolean
  title: ReactNode
  note?: ReactNode
  onSelect(): void
}) {
  return (
    <RowButton
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn('gap-3 rounded-none px-4 py-2.5 text-foreground', selected && 'bg-hover')}
    >
      <span className="min-w-0 flex-1">
        <strong className="flex items-center gap-2 font-medium">{title}</strong>
        {note && <span className="mt-0.5 block text-caption leading-[18px] text-muted-foreground">{note}</span>}
      </span>
      <span
        aria-hidden
        className={cn(
          'flex size-4 flex-none items-center justify-center rounded-full border',
          selected ? 'border-primary bg-primary text-primary-foreground' : 'border-(--edge)',
        )}
      >
        {selected && <Check size={11} strokeWidth={3} />}
      </span>
    </RowButton>
  )
}

/** The model new threads start on, from the providers that can run here. */
export function ModelChoiceStep({
  providers,
  choice,
  onChoice,
}: {
  providers: AgentProvider[]
  choice: DefaultModelChoice
  onChoice(choice: DefaultModelChoice): void
}) {
  const { catalogs, reload } = useModelSets()
  const { visibleModels } = useAppSettings().preferences
  const [checking, setChecking] = useState(false)
  const all = catalogs.flatMap((catalog) => catalog.models)
  const offered = providers.filter((provider) => all.some((model) => model.provider === provider))
  const models = onboardingModels(all, choice.provider, visibleModels)
  return (
    <div className="flex flex-col gap-3">
      {offered.length > 1 && (
        <div>
          <Dropdown
            label={t('Provider')}
            value={choice.provider}
            options={offered.map((provider) => ({ value: provider, label: providerName(provider) }))}
            onChange={(value) => {
              const provider = offered.find((entry) => entry === value)
              if (provider) onChoice(initialChoice(choice, provider, all))
            }}
          />
        </div>
      )}
      {models.length ? (
        <div
          role="radiogroup"
          aria-label={t('Default model')}
          className="overflow-hidden rounded-(--radius-m) bg-fill [&>*+*]:border-t [&>*+*]:border-(--line)"
        >
          {models.map((model) => (
            <Choice
              key={model.id}
              selected={model.id === choice.model}
              title={
                <>
                  <ProviderIcon provider={model.provider} size={14} />
                  {modelDisplayName(model.name)}
                  {model.isDefault && (
                    <Badge variant="secondary" className="font-normal">
                      {t('Recommended')}
                    </Badge>
                  )}
                </>
              }
              note={
                choosableEfforts(model).length
                  ? t('{0} effort levels', { 0: choosableEfforts(model).length })
                  : undefined
              }
              onSelect={() => onChoice(withModel(model, choice.effort))}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="m-0 min-w-0 flex-1 text-caption text-muted-foreground">
            {t('No models yet. Sign in to an agent, then check again, or choose later in Settings › Models.')}
          </p>
          <Button
            variant="ghost"
            disabled={checking}
            onClick={() => {
              setChecking(true)
              void reload()
                .catch(() => {})
                .finally(() => setChecking(false))
            }}
          >
            {checking ? t('Checking…') : t('Check again')}
          </Button>
        </div>
      )}
    </div>
  )
}

/** How hard the chosen model thinks by default; only the efforts it supports. */
export function EffortStep({
  model,
  choice,
  onChoice,
}: {
  model: AgentModel
  choice: DefaultModelChoice
  onChoice(choice: DefaultModelChoice): void
}) {
  return (
    <div className="flex flex-col gap-3">
      <div
        role="radiogroup"
        aria-label={t('Effort for {0}', { 0: modelDisplayName(model.name) })}
        className="overflow-hidden rounded-(--radius-m) bg-fill [&>*+*]:border-t [&>*+*]:border-(--line)"
      >
        {choosableEfforts(model).map((effort) => (
          <Choice
            key={effort}
            selected={effort === choice.effort}
            title={
              <>
                {effortDisplayName(effort, model.provider)}
                {effort === model.defaultEffort && (
                  <Badge variant="secondary" className="font-normal">
                    {t('Recommended')}
                  </Badge>
                )}
              </>
            }
            onSelect={() => onChoice({ ...choice, effort })}
          />
        ))}
      </div>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Higher steps and effort give better answers on hard work but use more tokens and take longer.')}
      </p>
    </div>
  )
}

export function TokensStep({ choices, onChoices }: { choices: TokenChoices; onChoices(choices: TokenChoices): void }) {
  const fewest = sameChoices(choices, FEWEST_TOKENS)
  return (
    <div className="flex flex-col gap-3">
      <Group>
        {TOKEN_FEATURES.map((feature) => (
          <Row
            key={feature.key}
            title={
              <>
                {t(feature.title)}
                <Badge variant={feature.cost === 'saves' ? 'secondary' : 'outline'} className="font-normal">
                  {feature.cost === 'saves' ? t('Saves tokens') : t('Uses more tokens')}
                </Badge>
              </>
            }
            help={t(feature.help)}
          >
            <Switch
              aria-label={t(feature.title)}
              checked={choices[feature.key]}
              onCheckedChange={(checked) => onChoices({ ...choices, [feature.key]: checked })}
            />
          </Row>
        ))}
      </Group>
      <div>
        <Button variant="ghost" disabled={fewest} onClick={() => onChoices(FEWEST_TOKENS)}>
          {fewest ? t('Using the fewest tokens') : t('Use the fewest tokens')}
        </Button>
      </div>
    </div>
  )
}

type Access = AgentSettings['access']

/** The access new threads start with; each thread can still change its own from the composer. */
export function AccessStep({ access, onAccess }: { access: Access; onAccess(access: Access): void }) {
  return (
    <div className="flex flex-col gap-3">
      <Group>
        <div
          role="radiogroup"
          aria-label={t('Default access')}
          className="flex flex-col [&>*+*]:border-t [&>*+*]:border-(--line)"
        >
          {accessModes.map(({ key, label, description, Icon }) => (
            <Choice
              key={key}
              selected={access === key}
              title={
                <>
                  <Icon size={15} className="text-muted-foreground" />
                  {t(label)}
                </>
              }
              note={t(description)}
              onSelect={() => onAccess(key)}
            />
          ))}
        </div>
      </Group>
      <p className="m-0 text-caption text-muted-foreground">
        {t('Commands that can destroy work, and production deploys, ask first in every mode.')}
      </p>
    </div>
  )
}

const LOOPBACK = /^(127\.|::1$|localhost$)/

/** The route to this host from elsewhere: the local network or a VPN. */
export function ReachStep({ onError }: { onError(message: string): void }) {
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const load = () =>
      void invoke('network.status').then(
        (next) => live && setStatus(next),
        () => {},
      )
    load()
    return () => {
      live = false
    }
  }, [])
  const run = async (work: () => Promise<NetworkStatus>) => {
    setBusy(true)
    onError('')
    try {
      setStatus(await work())
    } catch (e) {
      onError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  if (!status)
    return (
      <p className="m-0 text-caption text-muted-foreground" role="status">
        {t('Checking this host…')}
      </p>
    )
  const managed = status.source === 'command-line'
  const network = status.enabled && !LOOPBACK.test(status.host)
  return (
    <div className="flex flex-col gap-3">
      <Group>
        <Row
          title={
            <>
              <Wifi size={15} className="text-muted-foreground" />
              {t('Same network or VPN')}
            </>
          }
          help={
            managed
              ? t('Set when Ramu was started with --listen. Change it there.')
              : t(
                  'Devices on this Wi-Fi or your VPN (such as Tailscale) connect directly after pairing. Not encrypted by Ramu, so use a network you trust.',
                )
          }
        >
          <Switch
            aria-label={t('Same network or VPN')}
            checked={network}
            disabled={busy || managed}
            onCheckedChange={(checked) =>
              void run(() =>
                invoke('network.configure', {
                  enabled: checked,
                  host: checked && LOOPBACK.test(status.host) ? '0.0.0.0' : status.host,
                  port: status.port,
                  acceptUnencrypted: true,
                }),
              )
            }
          />
        </Row>
      </Group>
      <AccountSignIn onError={onError} />
      <p className="m-0 text-caption text-muted-foreground">
        {t('Pair a phone or another computer from Settings › Remote access whenever you are ready.')}
      </p>
    </div>
  )
}

export function ProjectStep({ projects, busy, onAdd }: { projects: Project[]; busy: boolean; onAdd(): void }) {
  return (
    <div className="flex flex-col gap-3">
      {projects.length > 0 && (
        <Group>
          {projects.map((project) => (
            <Row
              key={project.id}
              title={
                <>
                  <FolderGit2 size={15} className="text-muted-foreground" />
                  {project.name}
                </>
              }
            />
          ))}
        </Group>
      )}
      <div>
        <Button variant="secondary" disabled={busy} onClick={onAdd}>
          {projects.length ? t('Add another repository') : t('Choose repository')}
        </Button>
      </div>
    </div>
  )
}
