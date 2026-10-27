import { useCallback, useEffect, useState } from 'react'
import type { ProviderStatus } from '@ramu/shared/providers/providers'
import type { AgentProvider } from '@ramu/shared/types'
import { useModelSets } from './models/ModelSets'
import { Button } from '@/components/desktop-button'
import { Dialog, Dropdown } from './Menu'
import { invoke } from './ipc'
import { t } from './i18n'
import { useWorkspace } from './workspace/workspace'
import { useAddProject } from './workspace/addProject'
import { runProviderCommand } from './models/ProviderSetupTerminal'
import { errorText } from './lib/errors'

export function Onboarding() {
  const ws = useWorkspace(),
    add = useAddProject()
  const models = useModelSets()
  const [provider, setProvider] = useState<AgentProvider>(models.initialSettings.provider)
  const [open, setOpen] = useState(false),
    [step, setStep] = useState(0),
    [statuses, setStatuses] = useState<ProviderStatus[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const refresh = useCallback(async () => {
    setBusy(true)
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
    } finally {
      setBusy(false)
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
  const next = async () => {
    setBusy(true)
    setError('')
    try {
      if (statuses.some((status) => status.provider === provider && status.installed)) {
        const existing = models.preferences.sets.find((set) => set.steps[0]?.provider === provider)
        const model = models.catalogs
          .find((catalog) => catalog.provider === provider)
          ?.models.find((model) => model.isDefault)
        const step = existing?.steps[0] ?? {
          id: crypto.randomUUID(),
          name: provider,
          provider,
          model: model?.id ?? '',
          effort: model?.defaultEffort ?? null,
        }
        const set = existing ?? { id: crypto.randomUUID(), name: provider, steps: [step] }
        await models.save({
          ...models.preferences,
          sets: existing ? models.preferences.sets : [...models.preferences.sets, set],
          defaultSetId: set.id,
          defaultStepId: step.id,
        })
      }
      setStep(1)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  if (!open) return null
  return (
    <Dialog
      title={t('Welcome to Ramu')}
      confirmLabel={step === 1 ? t('Start working') : t('Choose a project')}
      busy={busy || add.busy}
      error={error}
      confirmDisabled={step === 1 && ws.projects.length === 0}
      onCancel={() => {
        void finish()
      }}
      onConfirm={() => {
        if (step === 0) void next()
        else void finish()
      }}
    >
      <p>{t('Chat with an agent beside your editor, terminal and Git. Let’s connect your tools and a project.')}</p>
      {step === 0 ? (
        <div className="flex flex-col gap-3">
          <p>{t('Use an installed provider and sign in with your own account.')}</p>
          {statuses.some((status) => status.installed) && (
            <Dropdown
              label={t('Default provider')}
              value={provider}
              options={statuses
                .filter((status) => status.installed)
                .map((status) => ({ value: status.provider, label: status.provider }))}
              onChange={(value) => setProvider(value as AgentProvider)}
            />
          )}
          {statuses.map((status) => (
            <div key={status.provider} className="flex items-center gap-2">
              <strong className="flex-1">{status.provider}</strong>
              <span>
                {status.installed
                  ? status.signIn?.default?.signedIn
                    ? t('Signed in')
                    : t('Installed')
                  : t('Not installed')}
              </span>
              {status.installed ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    void (async () => {
                      setError('')
                      try {
                        const command = await invoke('providers.loginCommand', status.provider)
                        if (command) runProviderCommand(`${status.provider} · ${t('Sign in')}`, command)
                        else await invoke('providers.signIn', status.provider)
                      } catch (e) {
                        setError(errorText(e))
                      }
                    })()
                  }}
                >
                  {t('Sign in')}
                </Button>
              ) : (
                <a href={status.docsUrl} target="_blank" rel="noreferrer">
                  {t('Setup instructions')}
                </a>
              )}
            </div>
          ))}
          <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
            {t('Check again')}
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p>{t('Choose the repository you want to work on. Your files stay where they are.')}</p>
          {ws.projects.map((project) => (
            <p key={project.id}>{project.name}</p>
          ))}
          <Button variant="outline" disabled={add.busy} onClick={() => void add.add()}>
            {t('Choose repository')}
          </Button>
        </div>
      )}
      <Button variant="link" onClick={() => void finish()}>
        {t('Set up later')}
      </Button>
    </Dialog>
  )
}
