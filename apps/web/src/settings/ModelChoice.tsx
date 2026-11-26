import type { IntelligencePreferences, ReasoningEffort } from '@ramu/shared/types'
import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import { Dropdown } from '../Menu'
import { Combobox } from '@/components/combobox'
import { t } from '../i18n'
import { effortDisplayName, useModelSets } from '../models/ModelSets'
import { modelOption } from '../models/modelOptions'
import { useAppSettings } from './AppSettings'

/** A model a setting runs on, as the preferences store it; `null` means the setting's own default. */
export type ModelChoiceValue = IntelligencePreferences['maintenanceModel']

const key = (provider: string, model: string) => `${provider}\n${model}`

/**
 * Picks any model the person keeps visible in Settings › Providers, by search, then its effort when it has several. A
 * setting is no longer limited to the steps of a model set.
 */
export function ModelChoice({
  label,
  value,
  emptyLabel,
  onChange,
}: {
  label: string
  value: ModelChoiceValue
  /** What no choice means for this setting, such as "Default model". */
  emptyLabel: string
  onChange: (value: ModelChoiceValue) => void
}) {
  const { catalogs } = useModelSets()
  const { visibleModels } = useAppSettings().preferences
  const models = catalogs
    .flatMap((catalog) => catalog.models)
    .filter(
      (model) =>
        (!model.isLegacy && isModelListed(visibleModels, model)) ||
        (value?.provider === model.provider && value.model === model.id),
    )
  const chosen = value
    ? models.find((model) => model.provider === value.provider && model.id === value.model)
    : undefined
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <Combobox
        label={label}
        value={value ? key(value.provider, value.model) : ''}
        searchPlaceholder={t('Search models')}
        emptyText={t('No matching models')}
        className="min-w-0 max-w-[230px]"
        options={[
          { value: '', label: emptyLabel },
          ...models.map((model) => modelOption(model, key(model.provider, model.id))),
        ]}
        onChange={(next) => {
          const model = models.find((entry) => key(entry.provider, entry.id) === next)
          onChange(model ? { provider: model.provider, model: model.id, effort: model.defaultEffort ?? null } : null)
        }}
      />
      {value && chosen && chosen.efforts.length > 1 && (
        <Dropdown
          label={t('Effort')}
          value={value.effort ?? chosen.defaultEffort ?? chosen.efforts[0]!}
          options={chosen.efforts.map((effort) => ({
            value: effort,
            label: effortDisplayName(effort, chosen.provider),
          }))}
          onChange={(effort) => onChange({ ...value, effort: effort as ReasoningEffort })}
          className="w-[110px]! min-w-0! flex-none"
        />
      )}
    </span>
  )
}
