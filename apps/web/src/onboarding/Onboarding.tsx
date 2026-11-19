import { useCallback, useEffect, useState } from 'react'
import { cn } from 'cn'
import type { IdentitySnapshot } from '@ramu/shared/identities'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import type { ModelPreferences } from '@ramu/shared/types'
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
import { choosableEfforts, shownChoice, withDefaultModel, type DefaultModelChoice } from './defaultModel'
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

const STEPS = [
  {
    key: 'agents',
    name: 'Agents',
    title: 'Connect your agents',
    lead: 'Ramu runs the coding agents you already use, signed in with your own accounts.',
  },
  {
    key: 'mode',
    name: 'Model control',
    title: 'Choose how you pick models',
    lead: 'Pick the control the model bar shows. Try each example; you can switch any time.',
  },
  {
    key: 'model',
    name: 'Model',
    title: 'Choose your default model',
    lead: 'New threads start on this model. Change it in any thread, or later in Settings.',
  },
  {
    key: 'effort',
    name: 'Effort',
    title: 'Choose how hard it thinks',
    lead: 'New threads start at this effort. The model bar changes it for one thread.',
  },
  {
    key: 'tokens',
    name: 'Agent features',
    title: 'Choose what agents do on their own',
    lead: 'These features help agents but spend model tokens. Change them later in Settings.',
  },
  {
    key: 'access',
    name: 'Access',
    title: 'Choose what agents do without asking',
    lead: 'New threads start with this access. Change it for one thread in the composer, or later in Settings.',
  },
  {
    key: 'identities',
    name: 'Identities',
    title: 'Choose who you commit as',
    lead: 'Each project acts as an identity, picked from its folder or remote: its commits and accounts follow it.',
  },
  {
    key: 'reach',
    name: 'Other devices',
    title: 'Reach Ramu from your other devices',
    lead: 'Use your phone or another computer with this host over your network, a VPN or your Ramu account. You can change this later.',
  },
  {
    key: 'project',
    name: 'Project',
    title: 'Choose a project',
    lead: 'Pick the repository you want to work on. Your files stay where they are.',
  },
] as const

type StepKey = (typeof STEPS)[number]['key']
type Mode = NonNullable<ModelPreferences['defaultBarMode']>

/** The step a reopened app returns to, on this device. */
const PROGRESS_KEY = 'ramu.onboarding-step'
const savedStep = (): StepKey | null => {
  const value = deviceStorage.getItem(PROGRESS_KEY)
  return STEPS.find((entry) => entry.key === value)?.key ?? null
}

/** Typing in a field, or pressing a control or a menu item, keeps Enter's own meaning there. */
const OWN_ENTER = 'button, a, textarea, [role="combobox"], [role="listbox"], [role="option"], [role^="menu"]'

/**
 * First-run setup, one step at a time: agents, model control, default model and effort, token-heavy features, default
 * access, who the host commits as and its GitHub sign-in, remote reach with the optional Ramu account, and a project.
 * Every step is prefilled, so Continue alone finishes it; the language can change from the first step on.
 */
export function Onboarding() {
  useLanguage()
  const ws = useWorkspace()
  const add = useAddProject()
  const models = useModelSets()
  const app = useAppSettings()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<StepKey>('agents')
  const [furthest, setFurthest] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null)
  const [picked, setChoice] = useState<DefaultModelChoice>(() => ({
    provider: models.initialSettings.provider,
    model: models.initialSettings.model,
    effort: models.initialSettings.effort,
  }))
  const [mode, setMode] = useState<Mode>(models.preferences.defaultBarMode ?? 'model')
  const [choices, setChoices] = useState<TokenChoices>(() => tokenChoicesOf(app.preferences))
  const [access, setAccess] = useState<AppPreferences['defaultAccess']>(app.preferences.defaultAccess)
  const [identities, setIdentities] = useState<IdentitySnapshot | null>(null)
  const [identityError, setIdentityError] = useState('')
  const [drafts, setDrafts] = useState<IdentityDrafts | null>(null)
  const [problem, setProblem] = useState<IdentityProblem | null>(null)

  const all = models.catalogs.flatMap((catalog) => catalog.models)
  const installed = statuses?.filter((status) => status.installed).map((status) => status.provider) ?? []
  const choice = shownChoice(picked, installed, all)
  const model = all.find((entry) => entry.provider === choice.provider && entry.id === choice.model)
  const steps = STEPS.filter((entry) => entry.key !== 'effort' || choosableEfforts(model).length)
  // A step that no longer applies (a restored Effort step after the model changed) shows the one after it instead.
  const order = STEPS.findIndex((entry) => entry.key === step)
  const index = Math.max(
    0,
    steps.findIndex((entry) => STEPS.indexOf(entry) >= order),
  )
  const key = steps[index]!.key

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
        const saved = savedStep()
        if (saved) {
          setStep(saved)
          setFurthest(STEPS.findIndex((entry) => entry.key === saved))
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
  const saveStep = async (next: StepKey | undefined) => {
    if (key === 'agents' && !all.some((entry) => installed.includes(entry.provider)))
      void models.reload().catch(() => {})
    if (key === 'mode' && mode !== (models.preferences.defaultBarMode ?? 'model'))
      await models.save({ ...models.preferences, defaultBarMode: mode })
    // The model and its effort save together, once, so a passing choice never leaves a step behind in the set.
    if ((key === 'model' && next !== 'effort') || key === 'effort') {
      const name = model ? `${modelDisplayName(model.name)} ${effortDisplayName(choice.effort, model.provider)}` : ''
      const updated = withDefaultModel(models.preferences, choice, name.trim())
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
      const next = steps[target]?.key
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
  const move = (next: StepKey) => {
    setError('')
    setProblem(null)
    setStep(next)
    setFurthest((current) =>
      Math.max(
        current,
        STEPS.findIndex((entry) => entry.key === next),
      ),
    )
    deviceStorage.setItem(PROGRESS_KEY, next)
  }
  const skip = () => {
    const next = steps[index + 1]?.key
    if (next) move(next)
  }

  if (!open) return null
  const last = index === steps.length - 1
  const current = steps[index]!
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
              const reached = STEPS.indexOf(entry) <= furthest
              return (
                <Button
                  key={entry.key}
                  variant="ghost"
                  // Steps already seen are one click away; later ones open through Continue so each saves in order.
                  disabled={busy || !reached || at === index}
                  aria-current={at === index ? 'step' : undefined}
                  aria-label={t('Step {0} of {1}: {2}', { 0: at + 1, 1: steps.length, 2: t(entry.name) })}
                  title={t(entry.name)}
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
              {t('Welcome to Ramu')} · {t('Step {0} of {1}', { 0: index + 1, 1: steps.length })} · {t(current.name)}
            </p>
            {/* Saved at once, so the rest of setup reads in the chosen language. */}
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
          </div>
          <DialogTitle className="m-0 text-heading font-semibold tracking-[-0.01em]">{t(current.title)}</DialogTitle>
          <p id="onboarding-lead" className="m-0 mt-1.5 text-soft">
            {t(current.lead)}
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
                // Restoring brings the choices the steps below would make, so setup ends here.
                onClick={() =>
                  void finish().then(() =>
                    window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'account' } })),
                  )
                }
              >
                {t('From a backup')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void finish().then(() =>
                    window.dispatchEvent(
                      new CustomEvent('ramu:settings', { detail: { section: 'account', target: 'Copy settings' } }),
                    ),
                  )
                }
              >
                {t('From another host')}
              </Button>
            </section>
          )}
          {key === 'agents' && <AgentsStep statuses={statuses} onRefresh={refresh} onError={setError} />}
          {key === 'mode' && <ModelsStep mode={mode} onMode={setMode} provider={choice.provider} />}
          {key === 'model' && <ModelChoiceStep providers={installed} choice={choice} onChoice={setChoice} />}
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
          {key === 'project' && <ProjectStep projects={ws.projects} busy={add.busy} onAdd={() => void add.add()} />}
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
