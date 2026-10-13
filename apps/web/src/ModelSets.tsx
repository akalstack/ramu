import { recommendedSets, migrateModelDefaults } from '@ramu/shared/modelDefaults'
import { errorText } from './errors'
import { t } from './i18n'
import { providerName } from '@ramu/shared/providers'
import { BootScreen } from './Brand'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_AGENT_SETTINGS, type AgentModel, type AgentProvider, type AgentSettings, type ModelPreferences, type ModelStep, type ProviderCatalog, type ReasoningEffort } from '@ramu/shared/types'
import { useAppSettings } from './AppSettings'
import { invoke } from './ipc'

export const modelDisplayName = (name: string) => name.replace(/^gpt-/i, 'GPT-').replace(/-(sol|luna|astra|terra)\b/gi, (_, family: string) => ` ${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()}`)
export const effortDisplayName = (effort: ReasoningEffort | null, provider: AgentProvider) => effort === 'low' && provider === 'codex' ? t('Light') : effort === 'xhigh' ? t('Extra High') : effort ? t(effort[0]!.toUpperCase() + effort.slice(1)) : provider === 'claude-code' || provider === 'codex' ? '' : t('Default')
/** The model and effort names Ramu shows for a chat's settings, as the model chip shows them. */
export function settingsNames(settings: AgentSettings, catalogs: ProviderCatalog[]): { model: string; effort: string } {
  const models = catalogs.flatMap((catalog) => catalog.models)
  const entry = models.find((item) => item.provider === settings.provider && item.id === settings.model) ?? (!settings.model ? models.find((item) => item.provider === settings.provider && item.isDefault) : undefined)
  const explicit = settings.provider === 'claude-code' || settings.provider === 'codex'
  return { model: modelDisplayName(entry?.name ?? (settings.model || `${providerName(settings.provider)} default`)), effort: effortDisplayName(settings.effort ?? (explicit ? entry?.defaultEffort ?? null : null), settings.provider) }
}

export function modelStepName(step: ModelStep, catalogs: ProviderCatalog[]) {
  const model = catalogs.flatMap((catalog) => catalog.models).find((entry) => entry.provider === step.provider && (entry.id === step.model || !step.model && entry.isDefault))
  return `${modelDisplayName(model?.name ?? (step.model || `${providerName(step.provider)} default`))} ${effortDisplayName(step.effort ?? (step.provider === 'claude-code' || step.provider === 'codex' ? model?.defaultEffort ?? null : null), step.provider)}`.trim()
}

export { recommendedSets } from '@ramu/shared/modelDefaults'

const Context = createContext<{
  preferences: ModelPreferences; catalogs: ProviderCatalog[]; error: string | null
  save: (preferences: ModelPreferences) => Promise<void>; reload: () => Promise<void>
  initialSettings: AgentSettings
} | null>(null)

export function ModelSetsProvider({ children }: { children: ReactNode }) {
  const app = useAppSettings()
  const [preferences, setPreferences] = useState<ModelPreferences | null>(null)
  const [catalogs, setCatalogs] = useState<ProviderCatalog[]>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let disposed = false
    void Promise.allSettled([invoke('settings.models.get'), invoke('agent.catalog')]).then(([saved, available]) => {
      if (disposed) return
      const list = available.status === 'fulfilled' ? available.value : []
      setCatalogs(list)
      const defaults = recommendedSets(list)
      const value = saved.status === 'fulfilled' && saved.value ? saved.value : defaults
      const updated = migrateModelDefaults(value, defaults)
      setPreferences(updated)
      if (updated !== value) void invoke('settings.models.set', updated).catch((reason) => { if (!disposed) setError(`Could not save updated defaults: ${errorText(reason)}`) })
      if (saved.status === 'rejected') setError(`Could not load saved model sets: ${String(saved.reason)}`)
    })
    return () => { disposed = true }
  }, [])
  if (!preferences) return <BootScreen />
  const selected = preferences.sets.find((set) => set.id === preferences.defaultSetId)?.steps.find((step) => step.id === preferences.defaultStepId) ?? preferences.sets[0]!.steps[0]!
  return <Context.Provider value={{ preferences, catalogs, error,
    initialSettings: { ...DEFAULT_AGENT_SETTINGS, access: app.preferences.defaultAccess, autoFallback: app.preferences.defaultAutoFallback, provider: selected.provider, model: selected.model, effort: selected.effort },
    save: async (value) => { await invoke('settings.models.set', value); setPreferences(value); setError(null) },
    reload: async () => { const list = await invoke('agent.catalog', true); setCatalogs(list) },
  }}>{children}</Context.Provider>
}
export function useModelSets() {
  const value = useContext(Context)
  if (!value) throw new Error('ModelSetsProvider missing')
  return value
}
