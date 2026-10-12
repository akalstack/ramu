import { t } from './i18n'
import { providerName } from '../../shared/providers'
import { BootScreen } from './Brand'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { DEFAULT_AGENT_SETTINGS, type AgentModel, type AgentProvider, type AgentSettings, type ModelPreferences, type ModelStep, type ProviderCatalog, type ReasoningEffort } from '../../shared/types'
import { useAppSettings } from './AppSettings'
import { invoke } from './ipc'

export const modelDisplayName = (name: string) => name.replace(/^gpt-/i, 'GPT-').replace(/-(sol|luna|astra|terra)\b/gi, (_, family: string) => ` ${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()}`)
export const effortDisplayName = (effort: ReasoningEffort | null, provider: AgentProvider) => effort === 'low' && provider === 'codex' ? t('Light') : effort === 'xhigh' ? t('Extra High') : effort ? t(effort[0]!.toUpperCase() + effort.slice(1)) : provider === 'claude-code' || provider === 'codex' ? '' : t('Default')

export function modelStepName(step: ModelStep, catalogs: ProviderCatalog[]) {
  const model = catalogs.flatMap((catalog) => catalog.models).find((entry) => entry.provider === step.provider && (entry.id === step.model || !step.model && entry.isDefault))
  return `${modelDisplayName(model?.name ?? (step.model || `${providerName(step.provider)} default`))} ${effortDisplayName(step.effort ?? (step.provider === 'claude-code' || step.provider === 'codex' ? model?.defaultEffort ?? null : null), step.provider)}`.trim()
}

export function recommendedSets(catalogs: ProviderCatalog[]): ModelPreferences {
  const models = catalogs.flatMap((catalog) => catalog.models).filter((model) => model.provider === 'codex')
  const family = (name: string, preferred: string) => models.find((model) => model.id === preferred)
    ?? models.find((model) => model.isDefault && new RegExp(`\\b${name}\\b`, 'i').test(`${model.name} ${model.id}`))
    ?? models.find((model) => new RegExp(`\\b${name}\\b`, 'i').test(`${model.name} ${model.id}`))
  const luna = family('luna', 'gpt-6-luna')
  const sol = family('sol', 'gpt-6.1-sol')
  const astra = family('astra', 'gpt-6-astra')
  const step = (id: string, name: string, model: AgentModel | undefined, fallbackId: string, effort: ReasoningEffort): ModelStep => ({ id, name, provider: 'codex', model: model?.id ?? fallbackId, effort })
  const steps = [
    step('luna-high', 'GPT-6 Luna High', luna, 'gpt-6-luna', 'high'),
    step('sol-light', 'GPT-6.1 Sol Light', sol, 'gpt-6.1-sol', 'low'),
    step('sol-medium', 'GPT-6.1 Sol Medium', sol, 'gpt-6.1-sol', 'medium'),
    step('astra-light', 'GPT-6 Astra Light', astra, 'gpt-6-astra', 'low'),
    step('astra-medium', 'GPT-6 Astra Medium', astra, 'gpt-6-astra', 'medium'),
  ]
  return { defaultBarMode: 'model', sets: [{ id: 'recommended', name: 'Default', steps }], defaultSetId: 'recommended', defaultStepId: 'sol-medium' }
}

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
      const old = value.sets.find((set) => set.id === 'recommended')
      // Replace only the earlier generated default, preserving user-edited sets.
      const oldNames = ['Light', 'Balanced', 'Deep', 'Advanced', 'Maximum']
      const oldIds = ['light', 'balanced', 'deep', 'advanced', 'maximum']
      const shortNames = ['Luna High', 'Sol Light', 'Sol Medium', 'Astra Light', 'Astra Medium']
      const isShortDefault = old?.steps.length === 5 && old.steps.every((step, index) => step.id === defaults.sets[0]!.steps[index]!.id && step.name === shortNames[index])
      if (old && (isShortDefault || old.steps.length === 5 && old.steps.every((step, index) => step.id === oldIds[index] && step.name === oldNames[index]))) {
        const updated = { ...value, sets: value.sets.map((set) => set.id === old.id ? { ...set, steps: defaults.sets[0]!.steps } : set), defaultStepId: value.defaultSetId === old.id && !isShortDefault ? 'sol-medium' : value.defaultStepId }
        setPreferences(updated)
        void invoke('settings.models.set', updated).catch((reason) => { if (!disposed) setError(`Could not save updated defaults: ${String(reason)}`) })
      } else setPreferences(value)
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
