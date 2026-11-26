import { ChevronRight } from 'lucide-react'
import type { AppPreferences } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { SettingsGroupTitle, SettingsLabel, SettingsRow } from '@/components/settings-row'
import { t } from '../i18n'
import { useModelSets } from '../models/ModelSets'
import { modelOption } from '../models/modelOptions'
import { type DraftSetter } from './constants'
import { ModelChoice, type ModelChoiceValue } from './ModelChoice'

/** The Models group these settings live in; other pages jump to it by this title. */
export const WORK_MODELS_TITLE = 'Models for Ramu’s own work'

/**
 * Settings › Models: the models Ramu's own work runs on. Each is chosen here once; the pages of the features that use
 * one say which model that is and lead back here, so the same choice is never offered in two places.
 */
export function WorkModelSettings({ draft, onChange }: { draft: AppPreferences; onChange: DraftSetter }) {
  return (
    <div className="settings-form flex flex-col gap-0 mt-8">
      <SettingsGroupTitle>{t(WORK_MODELS_TITLE)}</SettingsGroupTitle>
      <SettingsRow setting="intelligence.maintenanceModel">
        <SettingsLabel
          title={t('Background model')}
          help={t('Writes daily recaps, learning reviews and memory cleanup. A cheaper model keeps token use low.')}
        />
        <ModelChoice
          label={t('Background model')}
          value={draft.intelligence.maintenanceModel}
          emptyLabel={t('Default model')}
          onChange={(maintenanceModel) =>
            onChange({ ...draft, intelligence: { ...draft.intelligence, maintenanceModel } })
          }
        />
      </SettingsRow>
      <SettingsRow setting="commitModel">
        <SettingsLabel
          title={t('Writing model')}
          help={t('Writes commit messages and pull request titles and descriptions. Default uses your default model.')}
        />
        <ModelChoice
          label={t('Writing model')}
          value={draft.commitModel}
          emptyLabel={t('Default model')}
          onChange={(commitModel) => onChange({ ...draft, commitModel })}
        />
      </SettingsRow>
      <SettingsRow setting="asideModel">
        <SettingsLabel
          title={t('Aside model')}
          help={t('Answers side questions about a thread. Same as thread uses the model chosen in that thread.')}
        />
        <ModelChoice
          label={t('Aside model')}
          value={draft.asideModel}
          emptyLabel={t('Same as thread')}
          onChange={(asideModel) => onChange({ ...draft, asideModel })}
        />
      </SettingsRow>
    </div>
  )
}

/** On a feature's own page: the model it runs on, opening Settings › Models where that model is chosen. */
export function WorkModelNote({
  title,
  value,
  onOpen,
}: {
  title: 'Background model' | 'Writing model'
  value: ModelChoiceValue
  onOpen: () => void
}) {
  const { catalogs } = useModelSets()
  const model = value
    ? catalogs.flatMap((catalog) => catalog.models).find((m) => m.provider === value.provider && m.id === value.model)
    : undefined
  const name = model ? modelOption(model, model.id).label : (value?.model ?? t('Default model'))
  return (
    <SettingsRow>
      <SettingsLabel title={t(title)} help={t('Chosen once in Models, for every feature that uses it.')} />
      <Button variant="ghost" size="sm" className="flex-none" onClick={onOpen}>
        <span className="max-w-[200px] truncate">{name}</span>
        <ChevronRight size={13} aria-hidden="true" />
      </Button>
    </SettingsRow>
  )
}
