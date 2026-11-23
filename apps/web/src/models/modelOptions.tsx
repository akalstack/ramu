import type { AgentModel, AgentProvider } from '@ramu/shared/types'
import { providerName } from '@ramu/shared/providers/providers'
import { modelLabel, modelSearchText } from '@ramu/shared/providers/modelLabel'
import type { ComboboxOption } from '@/components/combobox'
import { t } from '../i18n'
import { ProviderIcon } from './ProviderIcon'

/**
 * A model as a Combobox row: its mark and clean name, under its provider, or under the route OpenCode takes to it
 * ("OpenRouter via OpenCode"). The full id stays in the tooltip and in what search reads.
 */
export function modelOption(model: AgentModel, value: string): ComboboxOption {
  const { name, route } = modelLabel(model)
  const provider = providerName(model.provider)
  return {
    value,
    label: name,
    group: route ? t('{0} via {1}', { '0': route, '1': provider }) : provider,
    icon: <ProviderIcon provider={model.provider} size={14} />,
    keywords: modelSearchText(model),
    title: `${model.id} · ${provider}`,
  }
}

/** A saved choice the catalogue no longer lists, so the picker still names what is set. */
export function missingModelOption(provider: AgentProvider, model: string, value: string): ComboboxOption {
  return {
    value,
    label: model ? t('{0} · Unavailable', { '0': model }) : t('{0} default', { '0': providerName(provider) }),
    icon: <ProviderIcon provider={provider} size={14} />,
    title: model ? `${model} · ${providerName(provider)}` : undefined,
  }
}
