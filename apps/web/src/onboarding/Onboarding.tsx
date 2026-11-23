import { useCallback, useEffect, useState } from 'react'
import { cn } from 'cn'
import type { IdentitySnapshot } from '@ramu/shared/identities'
import { providerEnabled, providerName, type ProviderStatus } from '@ramu/shared/providers/providers'
import type { AgentProvider, ModelPreferences } from '@ramu/shared/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { AppPreferences } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { deviceStorage } from '../deviceStorage'
import { Dropdown } from '../Menu'
import { effortDisplayName, modelDisplayName, useModelSets } from '../models/ModelSets'
import { useAppSettings } from '../settings/AppSettings'
import { invoke } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useWorkspace } from '../workspace/workspace'
import { useAddProject } from '../workspace/addProject'
import { ProviderIcon } from '../models/ProviderIcon'
import {
  activeProviders,
  choosableEfforts,
  providerChoice,
  withDefaultModel,
  withModelStep,
  type DefaultModelChoice,
} from './defaultModel'
import { setupSteps, stepIndex, type StepKind } from './flow'
import { IdentitiesStep } from './IdentitiesStep'
import { identitiesToAdd, identityDrafts, type IdentityDrafts, type IdentityProblem } from './identitySetup'
import {
  AccessStep,
  AgentsStep,
  EffortStep,
  ModelChoiceStep,
  ModelsStep,
  ProjectStep,
  ReachStep,
  TokensStep,
} from './OnboardingSteps'
import { applyTokenChoices, sameChoices, tokenChoicesOf, type TokenChoices } from './tokenChoices'

const TEXT: Record<StepKind, { name: string; title: string; lead: string }> = {
  agents: {
    name: 'Agents',
    title: 'Connect your agents',
    lead: 'Ramu runs the coding agents you already use, signed in with your own accounts.',
  },
  mode: {
    name: 'Model control',
    title: 'Choose how you pick models',
    lead: 'Pick the control the model bar shows. Try each example; you can switch any time.',
  },
  model: {
    name: 'Model',
    title: 'Choose your default model',
    lead: 'New threads start on this model. Change it in any thread, or later in Settings.',
  },
  effort: {
    name: 'Effort',
    title: 'Choose how hard it thinks',
    lead: 'New threads start at this effort. The model bar changes it for one thread.',
  },
  tokens: {
    name: 'Agent features',
    title: 'Choose what agents do on their own',
    lead: 'These features help agents but spend model tokens. Change them later in Settings.',
  },
  access: {
    name: 'Access',
    title: 'Choose what agents do without asking',
    lead: 'New threads start with this access. Change it for one thread in the composer, or later in Settings.',
  },
  identities: {
    name: 'Identities',
    title: 'Choose who you commit as',
    lead: 'Each project acts as an identity, picked from its folder or remote: its commits and accounts follow it.',
  },
  reach: {
    name: 'Your phone',
    title: 'Connect your phone',
    lead: 'Scan one code and Ramu is on your phone too. Skip it for now and connect later with the phone button in the sidebar.',
  },
  project: {
    name: 'Project',
    title: 'Choose a project',
    lead: 'Pick the repository you want to work on. Your files stay where they are.',
  },
}

type Mode = NonNullable<ModelPreferences['defaultBarMode']>

/** The step a reopened app returns to, on this device. */
const PROGRESS_KEY = 'ramu.onboarding-step'
const savedStep = (): string | null => deviceStorage.getItem(PROGRESS_KEY) || null

/** Typing in a field, or pressing a control or a menu item, keeps Enter's own meaning there. */
const OWN_ENTER = 'button, a, textarea, [role="combobox"], [role="listbox"], [role="option"], [role^="menu"]'

/**
 * First-run setup, one step at a time: agents (which run here, and which new threads start on), model control, a model
 * and effort for each of those agents, token-heavy features, default
 * access, who the host commits as and its GitHub sign-in, connecting a phone (or the optional Ramu account), and a project.
 * Every step is prefilled, so Continue alone finishes it; the language can change from the first step on.
 */
export function Onboarding() {
  useLanguage()
  const ws = useWorkspace()
  const add = useAddProject()
  const models = useModelSets()
  const app = useAppSettings()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState('agents')
  const [furthest, setFurthest] = useState('agents')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null)
  const saved: DefaultModelChoice = {
    provider: models.initialSettings.provider,
    model: models.initialSettings.model,
    effort: models.initialSettings.effort,
  }
  const [picks, setPicks] = useState<Partial<Record<AgentProvider, DefaultModelChoice>>>({})
  const [leadPick, setLeadPick] = useState<AgentProvider>(saved.provider)
  const [mode, setMode] = useState<Mode>(models.preferences.defaultBarMode ?? 'model')
  const [choices, setChoices] = useState<TokenChoices>(() => tokenChoicesOf(app.preferences))
  const [access, setAccess] = useState<AppPreferences['defaultAccess']>(app.preferences.defaultAccess)
  const [identities, setIdentities] = useState<IdentitySnapshot | null>(null)
  const [identityError, setIdentityError] = useState('')
  const [drafts, setDrafts] = useState<IdentityDrafts | null>(null)
  const [problem, setProblem] = useState<IdentityProblem | null>(null)

  const all = models.catalogs.flatMap((catalog) => catalog.models)
  const enabled = (provider: AgentProvider) => providerEnabled(app.preferences.providerBinaries, provider)
  const installed =
    statuses?.filter((status) => status.installed && enabled(status.provider)).map((status) => status.provider) ?? []
  const providers = activeProviders(installed, all, leadPick)
  const lead = providers[0] ?? leadPick
  const choiceFor = (provider: AgentProvider) => providerChoice(saved, provider, all, picks[provider])
  const modelOf = (choice: DefaultModelChoice) =>
    all.find((entry) => entry.provider === choice.provider && entry.id === choice.model)
  const steps = setupSteps(providers, (provider) => choosableEfforts(modelOf(choiceFor(provider))).length > 0)
  // A step that no longer applies (a restored Effort step after the model changed) shows the one after it instead.
  const index = stepIndex(steps, step)
  const current = steps[index]!
  const key = current.kind
  const provider = current.provider
  const choice = provider ? choiceFor(provider) : saved
  const model = provider ? modelOf(choice) : undefined
  const setChoice = (next: DefaultModelChoice) => setPicks((prev) => ({ ...prev, [next.provider]: next }))

  const refresh = useCallback(async () => {
    setError('')
    try {
      setStatuses(await invoke('providers.status'))
    } catch (e) {
      setError(errorText(e))
    }
  }, [])

  const loadIdentities = useCallback(() => {
    setIdentityError('')
    void invoke('identities.get').then(
      (snapshot) => {
        setIdentities(snapshot)
        setDrafts((current) => current ?? identityDrafts(snapshot, t('Personal')))
      },
      (e) => setIdentityError(errorText(e)),
    )
  }, [])

  useEffect(() => {
    void invoke('onboarding.get')
      .then(({ needed }) => {
        setOpen(needed)
        if (!needed) return
        void refresh()
        loadIdentities()
        const restored = savedStep()
        if (restored) {
          setStep(restored)
          setFurthest(restored)
        }
      })
      .catch(() => {})
  }, [refresh, loadIdentities])

  const finish = async () => {
    try {
      await invoke('onboarding.complete')
      deviceStorage.removeItem(PROGRESS_KEY)
      setOpen(false)
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Each step saves what it changed when the person moves on, so leaving early keeps what they chose.
  const saveStep = async (next: string | undefined) => {
    if (key === 'agents' && !all.some((entry) => installed.includes(entry.provider)))
      void models.reload().catch(() => {})
    if (key === 'mode' && mode !== (models.preferences.defaultBarMode ?? 'model'))
      await models.save({ ...models.preferences, defaultBarMode: mode })
    // A provider's model and effort save together, once, so a passing choice never leaves a step behind in the set.
    // The first provider's is where new threads start; the others join the default set beside it.
    if (provider && ((key === 'model' && next !== `effort:${provider}`) || key === 'effort')) {
      const name = model ? `${modelDisplayName(model.name)} ${effortDisplayName(choice.effort, model.provider)}` : ''
      const updated = (provider === lead ? withDefaultModel : withModelStep)(models.preferences, choice, name.trim())
      if (updated !== models.preferences) await models.save(updated)
    }
    if (key === 'tokens' && !sameChoices(choices, tokenChoicesOf(app.preferences)))
      await app.save(applyTokenChoices(app.preferences, choices))
    if (key === 'access' && access !== app.preferences.defaultAccess)
      await app.save({ ...app.preferences, defaultAccess: access })
    if (key === 'identities' && drafts && identities && !identities.settings.identities.length) {
      const plan = identitiesToAdd(drafts)
      if ('problem' in plan) {
        setProblem(plan.problem)
        throw new Error(t('Check the identity fields above.'))
      }
      setProblem(null)
      // Each one shows as soon as it exists, so a retry after a failure never adds it twice.
      for (const identity of plan.add) setIdentities(await invoke('identities.add', identity))
    }
  }

  const go = async (target: number) => {
    setBusy(true)
    setError('')
    try {
      const next = steps[target]?.id
      if (target > index) await saveStep(next)
      if (!next) return await finish()
      move(next)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  /** Moves on without saving this step, leaving its setting as it was. */
  const move = (next: string) => {
    setError('')
    setProblem(null)
    setStep(next)
    setFurthest((reached) => (stepIndex(steps, next) > stepIndex(steps, reached) ? next : reached))
    deviceStorage.setItem(PROGRESS_KEY, next)
  }
  const skip = () => {
    const next = steps[index + 1]?.id
    if (next) move(next)
  }

  /** Turning an agent on or off saves at once: the steps that follow ask only about the agents that run here. */
  const setEnabled = (target: AgentProvider, on: boolean) => {
    const config = app.preferences.providerBinaries
    void app
      .save({
        ...app.preferences,
        providerBinaries: { ...config, [target]: { binary: '', ...config[target], enabled: on } },
      })
      .catch((e: unknown) => setError(errorText(e)))
  }

  if (!open) return null
  const last = index === steps.length - 1
  const text = TEXT[key]
  const many = providers.length > 1
  const name = (entry: (typeof steps)[number]) =>
    entry.provider && many ? `${providerName(entry.provider)} · ${t(TEXT[entry.kind].name)}` : t(TEXT[entry.kind].name)
  const title =
    key === 'model' && provider && many
      ? t('Choose your {0} model', { 0: providerName(provider) })
      : key === 'effort' && model && many
        ? t('Choose how hard {0} thinks', { 0: modelDisplayName(model.name) })
        : t(text.title)
  const leadText =
    provider && provider !== lead
      ? key === 'model'
        ? t('Kept with your models, so any thread can switch to it. Change it later in Settings.')
        : t('Kept with this model. The model bar changes it for one thread.')
      : t(text.lead)
  return (
    <Dialog
      open
      disablePointerDismissal
      onOpenChange={(next, details) => {
        if (next) return
        if (busy) details.cancel()
        else void finish()
      }}
    >
      <DialogContent
        showCloseButton={false}
        aria-describedby="onboarding-lead"
        onKeyDown={(event) => {
          if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.defaultPrevented || busy) return
          if (event.target instanceof Element && event.target.closest(OWN_ENTER)) return
          event.preventDefault()
          void go(index + 1)
        }}
        className="onboarding flex max-h-[calc(100vh-48px)] w-[min(600px,calc(100vw-48px))] sm:max-w-none flex-col gap-0 overflow-hidden rounded-(--radius-l) p-0 [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_24px_64px_rgba(0,0,0,0.55)]"
      >
        <div className="flex-none px-6 pt-5 pb-4">
          <nav aria-label={t('Setup steps')} className="mb-4 flex items-center gap-1.5">
            {steps.map((entry, at) => {
              const reached = at <= stepIndex(steps, furthest)
              return (
                <Button
                  key={entry.id}
                  variant="ghost"
                  // Steps already seen are one click away; later ones open through Continue so each saves in order.
                  disabled={busy || !reached || at === index}
                  aria-current={at === index ? 'step' : undefined}
                  aria-label={t('Step {0} of {1}: {2}', { 0: at + 1, 1: steps.length, 2: name(entry) })}
                  title={name(entry)}
                  onClick={() => void go(at)}
                  className="h-auto min-h-0 flex-1 rounded-full p-0 py-1.5 hover:bg-transparent disabled:opacity-100"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'block h-1 w-full rounded-full transition-colors',
                      at <= index ? 'bg-primary' : reached ? 'bg-primary/40' : 'bg-(--line)',
                    )}
                  />
                </Button>
              )
            })}
          </nav>
          <div className="mb-1 flex items-center gap-2">
            <p className="m-0 min-w-0 flex-1 text-caption text-muted-foreground">
              {t('Welcome to Ramu')} · {t('Step {0} of {1}', { 0: index + 1, 1: steps.length })} · {name(current)}
            </p>
            {/* Chosen once, on the first step, and saved at once so the rest of setup reads in that language; it
                stays in Settings → Appearance after that. */}
            {index === 0 && (
              <Dropdown
                label={t('App language')}
                value={app.preferences.language}
                disabled={busy}
                className="w-[180px]! flex-none"
                options={[
                  { value: 'system', label: t('Follow system') },
                  { value: 'id', label: 'Bahasa Indonesia' },
                  { value: 'en', label: 'English' },
                ]}
                onChange={(language) =>
                  void app
                    .save({ ...app.preferences, language: language as AppPreferences['language'] })
                    .catch((e: unknown) => setError(errorText(e)))
                }
              />
            )}
          </div>
          <DialogTitle className="m-0 flex items-center gap-2.5 text-heading font-semibold tracking-[-0.01em]">
            {provider && <ProviderIcon provider={provider} size={20} />}
            {title}
          </DialogTitle>
          <p id="onboarding-lead" className="m-0 mt-1.5 text-soft">
            {leadText}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 [scrollbar-width:thin]">
          {key === 'agents' && (
            <section
              className="mb-4 flex flex-wrap items-center gap-2 rounded-(--radius-m) bg-fill p-3"
              aria-label={t('Restore your settings?')}
            >
              <div className="min-w-0 flex-1">
                <strong className="text-control">{t('Restore your settings?')}</strong>
                <p className="m-0 text-caption text-muted-foreground">
                  {t(
                    'Bring theme, models, rules and identities from a backup or another of your hosts. Nothing changes until you review it.',
                  )}
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                // Restoring brings the choices the steps below would make. Setup counts as done once a restore is
                // applied; leaving before that brings it back on the next launch.
                onClick={() => {
                  setOpen(false)
                  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'account' } }))
                }}
              >
                {t('From a backup')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setOpen(false)
                  window.dispatchEvent(
                    new CustomEvent('ramu:settings', { detail: { section: 'account', target: 'Copy settings' } }),
                  )
                }}
              >
                {t('From another host')}
              </Button>
            </section>
          )}
          {key === 'agents' && (
            <AgentsStep
              statuses={statuses}
              enabled={enabled}
              onEnabled={setEnabled}
              lead={many ? lead : undefined}
              canLead={(entry) => providers.includes(entry)}
              onLead={setLeadPick}
              onRefresh={refresh}
              onError={setError}
            />
          )}
          {key === 'mode' && <ModelsStep mode={mode} onMode={setMode} provider={lead} />}
          {key === 'model' && <ModelChoiceStep provider={provider} choice={choice} onChoice={setChoice} />}
          {key === 'effort' && model && <EffortStep model={model} choice={choice} onChoice={setChoice} />}
          {key === 'tokens' && <TokensStep choices={choices} onChoices={setChoices} />}
          {key === 'access' && <AccessStep access={access} onAccess={setAccess} />}
          {key === 'identities' && (
            <IdentitiesStep
              snapshot={identities}
              error={identityError}
              drafts={drafts}
              problem={problem}
              onDrafts={(next) => {
                setDrafts(next)
                setProblem(null)
              }}
            />
          )}
          {key === 'reach' && <ReachStep onError={setError} />}
          {key === 'project' && (
            <ProjectStep projects={ws.projects} busy={add.busy} onAdd={() => void add.add()} onError={setError} />
          )}
        </div>
        {error && (
          <p role="alert" className="m-0 px-6 pb-2 text-caption text-bad">
            {error}
          </p>
        )}
        <div className="flex flex-none items-center gap-2 border-t border-(--line) px-6 py-3.5">
          <Button variant="ghost" disabled={busy} onClick={() => void finish()}>
            {t('Set up later')}
          </Button>
          <span className="flex-1" />
          {index > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => void go(index - 1)}>
              {t('Back')}
            </Button>
          )}
          {!last && key !== 'agents' && (
            <Button variant="ghost" disabled={busy} title={t('Keep this step as it is and move on')} onClick={skip}>
              {t('Skip')}
            </Button>
          )}
          <Button
            variant="default"
            className={cn(PRIMARY_ACTION_CLASS, 'whitespace-nowrap')}
            disabled={busy || add.busy}
            onClick={() => void go(index + 1)}
          >
            {last ? (ws.projects.length ? t('Start working') : t('Finish')) : t('Continue')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
