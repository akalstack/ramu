import { useCallback, useEffect, useState } from 'react'
import { cn } from 'cn'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import type { AgentProvider, ModelPreferences } from '@ramu/shared/types'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/desktop-button'
import { PRIMARY_ACTION_CLASS } from '@/components/button-classes'
import { useModelSets } from '../models/ModelSets'
import { useAppSettings } from '../settings/AppSettings'
import { invoke } from '../ipc'
import { t, useLanguage } from '../i18n'
import { errorText } from '../lib/errors'
import { useWorkspace } from '../workspace/workspace'
import { useAddProject } from '../workspace/addProject'
import { AgentsStep, ModelsStep, ProjectStep, ReachStep, TokensStep } from './OnboardingSteps'
import { applyTokenChoices, sameChoices, tokenChoicesOf, type TokenChoices } from './tokenChoices'

const STEPS = [
  {
    title: 'Connect your agents',
    lead: 'Ramu runs the coding agents you already use, signed in with your own accounts.',
  },
  {
    title: 'Choose how you pick models',
    lead: 'Pick the control the model bar shows. Try each example; you can switch any time.',
  },
  {
    title: 'Choose what agents do on their own',
    lead: 'These features help agents but spend model tokens. Change them later in Settings.',
  },
  {
    title: 'Reach Ramu from anywhere',
    lead: 'Use your phone or another computer with this host. Pick any way; you can add the others later.',
  },
  { title: 'Choose a project', lead: 'Pick the repository you want to work on. Your files stay where they are.' },
] as const

type Mode = NonNullable<ModelPreferences['defaultBarMode']>

/** First-run setup: agents, model control, token-heavy features, remote reach and a project, each skippable. */
export function Onboarding() {
  useLanguage()
  const ws = useWorkspace()
  const add = useAddProject()
  const models = useModelSets()
  const app = useAppSettings()
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [statuses, setStatuses] = useState<ProviderStatus[] | null>(null)
  const [provider, setProvider] = useState<AgentProvider>(models.initialSettings.provider)
  const [mode, setMode] = useState<Mode>(models.preferences.defaultBarMode ?? 'model')
  const [choices, setChoices] = useState<TokenChoices>(() => tokenChoicesOf(app.preferences))

  const refresh = useCallback(async () => {
    setError('')
    try {
      const values = await invoke('providers.status')
      setStatuses(values)
      setProvider((current) =>
        values.some((status) => status.provider === current && status.installed)
          ? current
          : (values.find((status) => status.installed)?.provider ?? current),
      )
    } catch (e) {
      setError(errorText(e))
    }
  }, [])

  useEffect(() => {
    void invoke('onboarding.get')
      .then(({ needed }) => {
        setOpen(needed)
        if (needed) void refresh()
      })
      .catch(() => {})
  }, [refresh])

  const finish = async () => {
    try {
      await invoke('onboarding.complete')
      setOpen(false)
    } catch (e) {
      setError(errorText(e))
    }
  }

  // Each step saves what it changed when the person moves on, so leaving early keeps what they chose.
  const saveStep = async () => {
    if (step === 0 && statuses?.some((status) => status.provider === provider && status.installed)) {
      const existing = models.preferences.sets.find((set) => set.steps[0]?.provider === provider)
      const model = models.catalogs
        .find((catalog) => catalog.provider === provider)
        ?.models.find((entry) => entry.isDefault)
      const first = existing?.steps[0] ?? {
        id: crypto.randomUUID(),
        name: provider,
        provider,
        model: model?.id ?? '',
        effort: model?.defaultEffort ?? null,
      }
      const set = existing ?? { id: crypto.randomUUID(), name: provider, steps: [first] }
      await models.save({
        ...models.preferences,
        sets: existing ? models.preferences.sets : [...models.preferences.sets, set],
        defaultSetId: set.id,
        defaultStepId: first.id,
      })
    }
    if (step === 1 && mode !== (models.preferences.defaultBarMode ?? 'model'))
      await models.save({ ...models.preferences, defaultBarMode: mode })
    if (step === 2 && !sameChoices(choices, tokenChoicesOf(app.preferences)))
      await app.save(applyTokenChoices(app.preferences, choices))
  }

  const go = async (next: number) => {
    setBusy(true)
    setError('')
    try {
      if (next > step) await saveStep()
      if (next >= STEPS.length) await finish()
      else setStep(next)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null
  const last = step === STEPS.length - 1
  const current = STEPS[step]!
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
        className="onboarding flex max-h-[calc(100vh-48px)] w-[min(600px,calc(100vw-48px))] sm:max-w-none flex-col gap-0 overflow-hidden rounded-(--radius-l) p-0 [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_24px_64px_rgba(0,0,0,0.55)]"
      >
        <div className="flex-none px-6 pt-5 pb-4">
          <div className="mb-4 flex items-center gap-1.5" aria-hidden>
            {STEPS.map((entry, index) => (
              <span
                key={entry.title}
                className={cn(
                  'h-1 flex-1 rounded-full transition-colors',
                  index <= step ? 'bg-primary' : 'bg-(--line)',
                )}
              />
            ))}
          </div>
          <p className="m-0 mb-1 text-caption text-muted-foreground">
            {t('Welcome to Ramu')} · {t('Step {0} of {1}', { 0: step + 1, 1: STEPS.length })}
          </p>
          <DialogTitle className="m-0 text-heading font-semibold tracking-[-0.01em]">{t(current.title)}</DialogTitle>
          <p id="onboarding-lead" className="m-0 mt-1.5 text-soft">
            {t(current.lead)}
          </p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-4 [scrollbar-width:thin]">
          {step === 0 && (
            <AgentsStep
              statuses={statuses}
              provider={provider}
              onProvider={setProvider}
              onRefresh={refresh}
              onError={setError}
            />
          )}
          {step === 1 && <ModelsStep mode={mode} onMode={setMode} provider={provider} />}
          {step === 2 && <TokensStep choices={choices} onChoices={setChoices} />}
          {step === 3 && <ReachStep onError={setError} />}
          {step === 4 && <ProjectStep projects={ws.projects} busy={add.busy} onAdd={() => void add.add()} />}
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
          {step > 0 && (
            <Button variant="outline" disabled={busy} onClick={() => void go(step - 1)}>
              {t('Back')}
            </Button>
          )}
          <Button
            variant="default"
            className={cn(PRIMARY_ACTION_CLASS, 'whitespace-nowrap')}
            disabled={busy || add.busy}
            onClick={() => void go(step + 1)}
          >
            {last ? (ws.projects.length ? t('Start working') : t('Finish')) : t('Continue')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
