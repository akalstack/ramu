import type { ReasoningEffort } from '@ramu/shared/types'
import { DEFAULT_AGENT_SETTINGS } from '@ramu/shared/types'
import type { WorkModel, WorkModelChoice } from '@ramu/shared/providers/workModel'
import { isModelListed } from '@ramu/shared/providers/modelVisibility'
import { Dropdown } from '../Menu'
import { Combobox } from '@/components/combobox'
import { t } from '../i18n'
import { effortDisplayName, useModelSets } from '../models/ModelSets'
import { modelOption } from '../models/modelOptions'
import { useLoginChoices } from '../models/AccountPicker'
import { useAppSettings } from './AppSettings'

/** A model a setting runs on, as the preferences store it; `null` is the thread's own model. */
export type ModelChoiceValue = WorkModelChoice

const THREAD = 'thread'
const DEFAULT = 'default'
const key = (provider: string, model: string) => `${provider}\n${model}`

/** What a choice reads as, such as "Same as thread" or a model's name, wherever the choice is shown. */
export function useModelChoiceName(value: ModelChoiceValue): string {
  const { catalogs } = useModelSets()
  if (!value || 'use' in value) return value?.use === 'default' ? t('Default model') : t('Same as thread')
  const model = catalogs
    .flatMap((catalog) => catalog.models)
    .find((m) => m.provider === value.provider && m.id === value.model)
  return model ? modelOption(model, model.id).label : value.model
}

/**
 * The one picker for the models Ramu's own work runs on: the thread's own model, the default model, or any model the
 * person keeps visible in Settings › Providers, with its effort and, for a provider with several logins, which login.
 */
export function ModelChoice({
  label,
  value,
  onChange,
}: {
  label: string
  value: ModelChoiceValue
  onChange: (value: ModelChoiceValue) => void
}) {
  const { catalogs } = useModelSets()
  const { visibleModels } = useAppSettings().preferences
  const explicit: WorkModel | null = value && !('use' in value) ? value : null
  const models = catalogs
    .flatMap((catalog) => catalog.models)
    .filter(
      (model) =>
        (!model.isLegacy && isModelListed(visibleModels, model)) ||
        (explicit?.provider === model.provider && explicit.model === model.id),
    )
  const chosen = explicit
    ? models.find((model) => model.provider === explicit.provider && model.id === explicit.model)
    : undefined
  const logins = useLoginChoices({ ...DEFAULT_AGENT_SETTINGS, ...(explicit ?? {}) })
  return (
    <span className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      <Combobox
        label={label}
        value={explicit ? key(explicit.provider, explicit.model) : value && 'use' in value ? value.use : THREAD}
        searchPlaceholder={t('Search models')}
        emptyText={t('No matching models')}
        className="min-w-0 max-w-[230px]"
        options={[
          { value: THREAD, label: t('Same as thread') },
          { value: DEFAULT, label: t('Default model') },
          ...models.map((model) => modelOption(model, key(model.provider, model.id))),
        ]}
        onChange={(next) => {
          if (next === THREAD || next === DEFAULT) return onChange({ use: next })
          const model = models.find((entry) => key(entry.provider, entry.id) === next)
          if (!model) return
          // A login carries over while the provider stays the same; another provider starts on its first.
          const accountId = explicit?.provider === model.provider ? explicit.accountId : undefined
          onChange({
            provider: model.provider,
            model: model.id,
            effort: model.defaultEffort ?? null,
            ...(accountId ? { accountId } : {}),
          })
        }}
      />
      {explicit && chosen && chosen.efforts.length > 1 && (
        <Dropdown
          label={t('Effort')}
          value={explicit.effort ?? chosen.defaultEffort ?? chosen.efforts[0]!}
          options={chosen.efforts.map((effort) => ({
            value: effort,
            label: effortDisplayName(effort, chosen.provider),
          }))}
          onChange={(effort) => onChange({ ...explicit, effort: effort as ReasoningEffort })}
          className="w-[110px]! min-w-0! flex-none"
        />
      )}
      {explicit && logins && (
        <Dropdown
          label={t('Account')}
          value={logins.current}
          options={logins.order.map((id) => ({ value: id, label: logins.name(id) }))}
          onChange={(accountId) => onChange({ ...explicit, accountId })}
          className="w-[150px]! min-w-0! flex-none"
        />
      )}
    </span>
  )
}
