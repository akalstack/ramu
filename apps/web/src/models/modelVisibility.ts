import { useSyncExternalStore } from 'react'
import type { AgentModel, AgentSettings } from '@ramu/shared/types'
import { isModelListed, type VisibleModels } from '@ramu/shared/providers/modelVisibility'
import { deviceStorage } from '../deviceStorage'

const KEY = 'ramu.show-legacy-models'
const snapshot = () => deviceStorage.getItem(KEY) === 'true'
const subscribe = (listener: () => void) =>
  deviceStorage.subscribe((key) => {
    if (key === KEY) listener()
  })

/** A local presentation preference, shared across this device's host windows. */
export function useShowLegacyModels() {
  const show = useSyncExternalStore(subscribe, snapshot, snapshot)
  return [show, (value: boolean) => deviceStorage.setItem(KEY, String(value))] as const
}

/**
 * Search, favorites and the current selection keep older choices discoverable without changing their settings. A model
 * left out in Settings → Providers stays out of search too, or the list would fill up again as soon as someone types;
 * only a favorite or the model in use still shows.
 */
export function visiblePickerModels(
  models: AgentModel[],
  options: {
    showLegacy: boolean
    query: string
    settings: AgentSettings
    favorites: string[]
    visible?: VisibleModels
  },
): AgentModel[] {
  const { showLegacy, query, settings, favorites, visible } = options
  return models.filter((model) => {
    const kept =
      favorites.includes(`${model.provider}:${model.id}`) ||
      (settings.provider === model.provider && (settings.model === model.id || (!settings.model && model.isDefault)))
    return kept || (isModelListed(visible, model) && (!model.isLegacy || showLegacy || !!query.trim()))
  })
}
