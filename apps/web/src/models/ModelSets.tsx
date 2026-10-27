import { recommendedSets, migrateModelDefaults } from '@ramu/shared/providers/modelDefaults'
import { sameValue } from '@ramu/shared/settingsCompatibility'
import { errorText } from '../lib/errors'
import { t } from '../i18n'
import { providerName } from '@ramu/shared/providers/providers'
import { BootScreen } from '../Brand'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode, type ContextType } from 'react'
import {
  DEFAULT_AGENT_SETTINGS,
  type AgentProvider,
  type AgentSettings,
  type ModelPreferences,
  type ModelStep,
  type ProviderCatalog,
  type ReasoningEffort,
} from '@ramu/shared/types'
import { useAppSettings } from '../settings/AppSettings'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'

export const modelDisplayName = (name: string) =>
  name
    .replace(/^gpt-/i, 'GPT-')
    .replace(
      /-(sol|luna|astra|terra)\b/gi,
      (_, family: string) => ` ${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()}`,
    )
export const effortDisplayName = (effort: ReasoningEffort | null, _provider: AgentProvider) =>
  effort === 'xhigh' ? t('Extra High') : effort ? t(effort[0]!.toUpperCase() + effort.slice(1)) : ''
/** The model and effort names Ramu shows for a chat's settings, as the model chip shows them. */
export function settingsNames(settings: AgentSettings, catalogs: ProviderCatalog[]): { model: string; effort: string } {
  const models = catalogs.flatMap((catalog) => catalog.models)
  const entry =
    models.find((item) => item.provider === settings.provider && item.id === settings.model) ??
    (!settings.model ? models.find((item) => item.provider === settings.provider && item.isDefault) : undefined)
  return {
    model: modelDisplayName(entry?.name ?? (settings.model || `${providerName(settings.provider)} default`)),
    effort: effortDisplayName(settings.effort ?? entry?.defaultEffort ?? null, settings.provider),
  }
}

export function modelStepName(step: ModelStep, catalogs: ProviderCatalog[]) {
  const model = catalogs
    .flatMap((catalog) => catalog.models)
    .find((entry) => entry.provider === step.provider && (entry.id === step.model || (!step.model && entry.isDefault)))
  return `${modelDisplayName(model?.name ?? (step.model || `${providerName(step.provider)} default`))} ${effortDisplayName(step.effort ?? model?.defaultEffort ?? null, step.provider)}`.trim()
}

export { recommendedSets } from '@ramu/shared/providers/modelDefaults'

const Context = createContext<{
  preferences: ModelPreferences
  catalogs: ProviderCatalog[]
  error: string | null
  save: (preferences: ModelPreferences) => Promise<void>
  reload: () => Promise<void>
  initialSettings: AgentSettings
} | null>(null)

export function ModelSetsProvider({ children }: { children: ReactNode }) {
  const { invoke } = useHost()
  const { on } = useHostRuntime()
  const app = useAppSettings()
  const [preferences, setPreferences] = useState<ModelPreferences | null>(null)
  const [catalogs, setCatalogs] = useState<ProviderCatalog[]>([])
  const [error, setError] = useState<string | null>(null)
  const requests = useRef(0)
  const edits = useRef(0)
  const pushed = useRef<ModelPreferences | null>(null)
  const providerSelection = JSON.stringify(app.preferences.providerBinaries)
  useEffect(() => {
    let disposed = false
    const request = ++requests.current
    const edit = edits.current
    void Promise.allSettled([invoke('settings.models.get'), invoke('agent.catalog')]).then(([saved, available]) => {
      if (disposed || request !== requests.current) return
      const list = available.status === 'fulfilled' ? available.value : []
      setCatalogs(list)
      if (edit !== edits.current) return
      const defaults = recommendedSets(list)
      const value = saved.status === 'fulfilled' && saved.value ? saved.value : defaults
      const updated = migrateModelDefaults(value, defaults)
      setPreferences(updated)
      if (updated !== value)
        void invoke('settings.app.snapshot')
          .then((snapshot) => {
            if (disposed || request !== requests.current || edit !== edits.current) return
            const field = snapshot.settings.find((field) => field.path === '$models')
            if (!field) throw new Error(t('Update the host to save model defaults safely.'))
            return invoke('settings.app.patch', [
              { path: field.path, schema: field.schema, before: value, value: updated },
            ])
          })
          .catch((reason) => {
            if (!disposed && request === requests.current && edit === edits.current)
              setError(`Could not save updated defaults: ${errorText(reason)}`)
          })
      if (saved.status === 'rejected') setError(`Could not load saved model sets: ${String(saved.reason)}`)
    })
    return () => {
      disposed = true
      requests.current = request + 1
    }
  }, [invoke, providerSelection])
  useEffect(
    () =>
      on('settings:models', (value) => {
        edits.current++
        pushed.current = value
        setPreferences(value)
        setError(null)
      }),
    [on],
  )
  if (!preferences) return <BootScreen />
  const selected =
    preferences.sets
      .find((set) => set.id === preferences.defaultSetId)
      ?.steps.find((step) => step.id === preferences.defaultStepId) ?? preferences.sets[0]!.steps[0]!
  return (
    <Context.Provider
      value={{
        preferences,
        catalogs,
        error,
        initialSettings: {
          ...DEFAULT_AGENT_SETTINGS,
          access: app.preferences.defaultAccess,
          autoFallback: app.preferences.defaultAutoFallback,
          provider: selected.provider,
          model: selected.model,
          effort: selected.effort,
        },
        save: async (value) => {
          const request = requests.current
          const snapshot = await invoke('settings.app.snapshot')
          const edit = edits.current
          const modeOnly = sameValue(
            { ...value, defaultBarMode: undefined },
            { ...preferences, defaultBarMode: undefined },
          )
          const modeField = modeOnly
            ? snapshot.settings.find((field) => field.path === '$models.defaultBarMode')
            : undefined
          const field = modeField ?? snapshot.settings.find((field) => field.path === '$models')
          if (!field) throw new Error(t('Update the host to save model preferences safely.'))
          const saved = await invoke('settings.app.patch', [
            {
              path: field.path,
              schema: field.schema,
              before: modeField
                ? (preferences.defaultBarMode ?? 'model')
                : snapshot.models === null
                  ? null
                  : preferences,
              value: modeField ? (value.defaultBarMode ?? 'model') : value,
            },
          ])
          if (
            request === requests.current &&
            saved.models &&
            (edit === edits.current || sameValue(pushed.current, saved.models))
          ) {
            edits.current++
            setPreferences(saved.models)
            setError(null)
          }
        },
        reload: async () => {
          const request = requests.current
          const edit = edits.current
          const list = await invoke('agent.catalog', true)
          if (request !== requests.current) return
          setCatalogs(list)
          const saved = await invoke('settings.models.get')
          if (saved && request === requests.current && edit === edits.current) setPreferences(saved)
        },
      }}
    >
      {children}
    </Context.Provider>
  )
}
export function useModelSets() {
  const value = useContext(Context)
  if (!value) throw new Error('ModelSetsProvider missing')
  return value
}

export function ModelSetsOverride({
  value,
  children,
}: {
  value: NonNullable<ContextType<typeof Context>>
  children: ReactNode
}) {
  return <Context.Provider value={value}>{children}</Context.Provider>
}
