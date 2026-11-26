import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Check,
  ExternalLink,
  FolderGit2,
  Layers,
  QrCode,
  SlidersHorizontal,
  Smartphone,
  SquareTerminal,
} from 'lucide-react'
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
import { invoke, ramu } from '../ipc'
import { t } from '../i18n'
import { errorText } from '../lib/errors'
import { effortDisplayName, modelDisplayName, modelStepName, useModelSets } from '../models/ModelSets'
import { ProviderIcon } from '../models/ProviderIcon'
import { runProviderCommand, useSignInWatch } from '../models/ProviderSetupTerminal'
import { useAppSettings } from '../settings/AppSettings'
import { choosableEfforts, onboardingModels, withModel, type DefaultModelChoice } from './defaultModel'
import { FEWEST_TOKENS, TOKEN_FEATURES, sameChoices, type TokenChoices } from './tokenChoices'
import { Group, Row } from './parts'
import { AccountSignIn } from './SignInRows'
import { LoadingDots } from '@/components/loading-dots'
import { PairingCode } from '../settings/PairingCode'
import { defaultPairUrl, pairingNetwork } from '@ramu/shared/pairingOffer'
import { usePairingOffer } from '../settings/usePairingOffer'
import { StayReachable } from '../settings/StayReachable'
import { TerminalCommandButton, terminalCommandHelp, useTerminalCommand } from '../settings/TerminalCommand'
import { AntigravitySignIn } from '../settings/AntigravitySignIn'
import { antigravityKeyName } from '@ramu/shared/providers/environment'

export function AgentsStep({
  statuses,
  enabled,
  onEnabled,
  lead,
  leads,
  onLead,
  onRefresh,
  onError,
}: {
  statuses: ProviderStatus[] | null
  enabled(provider: AgentProvider): boolean
  onEnabled(provider: AgentProvider, on: boolean): void
  /** The agent new threads start on. */
  lead?: AgentProvider
  /** The agents that can be the default: on, installed, with models to start on. */
  leads: AgentProvider[]
  onLead(provider: AgentProvider): void
  onRefresh(): Promise<void>
  onError(message: string): void
}) {
  const [checking, setChecking] = useState(false)
  /** Key variables the host already has, while Antigravity's sign-in dialog is open. */
  const [antigravityKeys, setAntigravityKeys] = useState<string[] | null>(null)
  // The row turns to Signed in once the login holds, and the terminal closes, without pressing Check again.
  const signingIn = useRef<AgentProvider | null>(null)
  const watchSignIn = useSignInWatch(async () => {
    const provider = signingIn.current
    if (!provider) return true
    const signedIn = !!(await invoke('providers.statusOf', provider)).signIn?.default?.signedIn
    if (signedIn) await onRefresh()
    return signedIn
  })
  const signIn = async (status: ProviderStatus) => {
    onError('')
    try {
      const command = await invoke('providers.loginCommand', status.provider)
      if (command) {
        signingIn.current = status.provider
        runProviderCommand(`${providerName(status.provider)} · ${t('Sign in')}`, command)
        watchSignIn()
      } else if (status.provider === 'antigravity') {
        const environment = await Promise.resolve(invoke('providers.environment')).catch(() => null)
        setAntigravityKeys(environment?.keys.antigravity ?? [])
      } else await invoke('providers.signIn', status.provider)
    } catch (e) {
      onError(errorText(e))
    }
  }
  return (
    <div className="flex flex-col gap-3">
      {antigravityKeys && (
        <AntigravitySignIn
          hasKey={(method) => antigravityKeys.includes(antigravityKeyName(method))}
          onClose={() => setAntigravityKeys(null)}
          onSubmit={async (input) => {
            const started = await invoke('providers.signIn', 'antigravity', 'default', input)
            if (!started) void onRefresh()
            return started
          }}
          onCode={async (code) => {
            await invoke('providers.completeSignIn', 'antigravity', 'default', code)
            if (code !== null) void onRefresh()
          }}
        />
      )}
      {/* The choice comes first; the list below is where an agent is signed in or turned on to join it. */}
      {leads.length > 0 && (
        <div
          role="radiogroup"
          aria-label={t('Default agent')}
          className="overflow-hidden rounded-(--radius-m) bg-fill [&>*+*]:border-t [&>*+*]:border-(--line)"
        >
          {leads.map((provider) => (
            <Choice
              key={provider}
              selected={provider === lead}
              title={
                <>
                  <ProviderIcon provider={provider} size={15} />
                  {providerName(provider)}
                </>
              }
              onSelect={() => onLead(provider)}
            />
          ))}
        </div>
      )}
      {statuses !== null && (
        <h3 className="m-0 mt-2 text-caption font-medium text-muted-foreground">
          {leads.length ? t('Agents on this host') : t('Sign in to an agent to choose your default')}
        </h3>
      )}
      {statuses === null ? (
        <p className="m-0 text-caption text-muted-foreground" role="status">
          {t('Looking for installed agents…')}
        </p>
      ) : (
        <Group>
          {statuses.map((status) => {
            const on = enabled(status.provider)
            // At least one agent stays on, as in Settings › Providers.
            const lastOn = on && statuses.filter((entry) => enabled(entry.provider)).length === 1
            return (
              <Row
                key={status.provider}
                title={
                  <>
                    <ProviderIcon provider={status.provider} size={15} className={on ? '' : 'opacity-40'} />
                    <span className={on ? '' : 'text-muted-foreground'}>{providerName(status.provider)}</span>
                  </>
                }
                help={
                  !on
                    ? t('Off: Ramu does not start it or show its models')
                    : status.installed
                      ? status.signIn?.default?.signedIn
                        ? t('Signed in')
                        : t('Installed')
                      : t('Not installed')
                }
              >
                {!on ? null : status.installed ? (
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
                <Switch
                  aria-label={t('Use {0}', { 0: providerName(status.provider) })}
                  title={lastOn ? t('At least one agent stays on') : undefined}
                  checked={on}
                  disabled={lastOn}
                  onCheckedChange={(checked) => onEnabled(status.provider, checked)}
                />
              </Row>
            )
          })}
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
      <div className="mt-1.5 flex justify-between gap-2 text-micro text-muted-foreground">
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

/** One provider's model, its recommended one preselected; with no provider ready, how to get models. */
export function ModelChoiceStep({
  provider,
  choice,
  onChoice,
}: {
  provider?: AgentProvider
  choice: DefaultModelChoice
  onChoice(choice: DefaultModelChoice): void
}) {
  const { catalogs, reload } = useModelSets()
  const { visibleModels } = useAppSettings().preferences
  const [checking, setChecking] = useState(false)
  const all = catalogs.flatMap((catalog) => catalog.models)
  const models = provider ? onboardingModels(all, provider, visibleModels) : []
  return (
    <div className="flex flex-col gap-3">
      {models.length ? (
        <div
          role="radiogroup"
          aria-label={t('Default model')}
          // A provider with many models scrolls inside its own list, so the effort choice under it stays in view.
          className="max-h-[min(310px,_38vh)] overflow-y-auto rounded-(--radius-m) bg-fill [&>*+*]:border-t [&>*+*]:border-(--line)"
        >
          {models.map((model) => (
            <Choice
              key={model.id}
              selected={model.id === choice.model}
              title={
                <>
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

/**
 * Connecting a phone during setup: one action allows devices on this network, makes the host visible to nearby ones
 * and shows a QR code the phone's camera opens, then says which device paired. The Ramu account stays the way to
 * connect from anywhere.
 */
export function ReachStep({ onError }: { onError(message: string): void }) {
  const [status, setStatus] = useState<NetworkStatus | null>(null)
  const [showing, setShowing] = useState(false),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    const load = () =>
      void invoke('network.status').then(
        (next) => live && setStatus(next),
        () => {},
      )
    load()
    // While the code is wanted, the listener may still be starting; once it listens the code appears.
    const id = showing ? window.setInterval(load, 2000) : undefined
    return () => {
      live = false
      window.clearInterval(id)
    }
  }, [showing])
  const ready = showing && !!status?.reachable
  const pairing = usePairingOffer(invoke, 'owner', ready)
  const show = async () => {
    if (!status) return
    setBusy(true)
    onError('')
    try {
      const change = pairingNetwork(status)
      if (change) setStatus(await invoke('network.configure', change))
      setShowing(true)
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
  const offer = pairing.offer
  const url = offer ? defaultPairUrl(offer.urls) : undefined
  return (
    <div className="flex flex-col gap-3">
      {!showing ? (
        <Group>
          <Row
            title={
              <>
                <Smartphone size={15} className="text-muted-foreground" />
                {t('Your phone')}
              </>
            }
            help={
              pairingNetwork(status)
                ? t(
                    'Pair it once to follow threads, review changes and answer approvals from your phone. This lets devices on your network or VPN reach this host. Ramu does not encrypt that connection, so use a network you trust.',
                  )
                : t('Pair it once to follow threads, review changes and answer approvals from your phone.')
            }
          >
            <Button variant="default" disabled={busy} onClick={() => void show()}>
              <QrCode size={14} />
              {t('Show pairing code')}
            </Button>
          </Row>
        </Group>
      ) : !ready ? (
        <p className="m-0 text-caption text-muted-foreground" role="status">
          {status.error
            ? t('Cannot listen on {0}:{1} ({2}). Local use still works, and Ramu keeps retrying.', {
                0: status.host,
                1: status.port,
                2: status.error,
              })
            : t('Getting this host ready for your phone…')}
        </p>
      ) : pairing.joined ? (
        <>
          <Group>
            <Row
              title={
                <>
                  <Check size={15} className="text-primary" />
                  {t('{0} is paired', { 0: pairing.joined.name })}
                </>
              }
              help={t('It can use this host now. Manage it in Settings › Devices & access.')}
            >
              <Button onClick={pairing.renew}>{t('Pair another')}</Button>
            </Row>
          </Group>
          {/* Paired, the phone needs this host after a restart too. */}
          <StayReachable />
        </>
      ) : offer ? (
        <>
          <PairingCode offer={offer} now={pairing.now} url={url} name={status.discovery?.name}>
            <span className="mt-1 text-caption leading-[18px] text-muted-foreground">
              {t('Scan with your phone’s camera. It opens Ramu, or the App Store or Google Play first.')}
            </span>
          </PairingCode>
          <p className="m-0 flex items-center gap-2 text-caption text-muted-foreground" role="status">
            <LoadingDots />
            {t('Waiting for your phone…')}
          </p>
        </>
      ) : (
        <p className="m-0 text-caption text-muted-foreground" role={pairing.error ? 'alert' : 'status'}>
          {pairing.error ?? t('Making the code…')}
        </p>
      )}
      <p className="m-0 mt-1 text-caption text-muted-foreground">
        {t('Or sign in to your Ramu account on both devices to connect from anywhere.')}
      </p>
      <AccountSignIn onError={onError} />
    </div>
  )
}

export function ProjectStep({
  projects,
  busy,
  onAdd,
  onError,
}: {
  projects: Project[]
  busy: boolean
  onAdd(): void
  onError(message: string): void
}) {
  const command = useTerminalCommand(onError)
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
      {command.status && (
        <Group className="mt-3">
          <Row
            title={
              <>
                <SquareTerminal size={15} className="text-muted-foreground" />
                {t('Use Ramu from your terminal')}
              </>
            }
            help={terminalCommandHelp(command.status)}
          >
            <TerminalCommandButton command={command} />
          </Row>
        </Group>
      )}
    </div>
  )
}
