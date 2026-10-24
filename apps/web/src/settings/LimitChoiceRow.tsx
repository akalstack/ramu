import { Button } from '@/components/desktop-button'
import { useContext } from 'react'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import type { AppPreferences } from '@ramu/shared/types'
import {
  LIMIT_CHOICE_HELP,
  LIMIT_CHOICE_TITLE,
  limitChoiceOf,
  limitChoiceOptions,
  limitChoicePatch,
  type LimitChoice,
} from '@ramu/shared/chat/limitPolicy'
import { t, useLanguage } from '../i18n'
import { Dropdown } from '../Menu'
import { SettingsScopeContext } from './SettingsScope'

/** The two stored values behind the one choice. Both are edited, saved and compared across hosts together. */
export const LIMIT_CHOICE_PATHS = ['defaultAutoFallback', 'fallback.autoResume'] as const

const MIXED = '__ramu_mixed__'

/** What a settings draft looks like after picking an option: both stored values written. */
export function withLimitChoice(draft: AppPreferences, choice: LimitChoice): AppPreferences {
  const { defaultAutoFallback, autoResume } = limitChoicePatch(choice)
  return { ...draft, defaultAutoFallback, fallback: { ...draft.fallback, autoResume } }
}

/**
 * Settings > Access > "When a usage limit is reached": Switch to another model, Wait on this model, or Stop and let me
 * decide, writing `defaultAutoFallback` and `fallback.autoResume`. Across several hosts it is Mixed when either value
 * differs, and a pick marks both values for every host.
 */
export function LimitChoiceRow({
  draft,
  onChange,
  busy,
}: {
  draft: AppPreferences
  onChange: (next: AppPreferences) => void
  busy: boolean
}) {
  useLanguage()
  const scope = useContext(SettingsScopeContext)
  const fields = scope ? LIMIT_CHOICE_PATHS.map((path) => scope.field(path)) : []
  const mixed = fields.some((field) => field.mixed)
  const unsupported = fields.some((field) => field.disabled)
  const markBoth = () => {
    for (const path of LIMIT_CHOICE_PATHS) scope?.mark(path)
  }
  const choice = limitChoiceOf(draft)
  const options = limitChoiceOptions(choice).map((option) => ({ value: option.value, label: t(option.label) }))
  return (
    <SettingsRow>
      <span>
        <SettingsLabel title={t(LIMIT_CHOICE_TITLE)} help={t(LIMIT_CHOICE_HELP)} />
        {unsupported ? (
          <span className="block mt-1 text-caption text-muted-foreground">
            {t('Not supported by every selected host.')}
          </span>
        ) : mixed ? (
          <span className="flex flex-wrap items-center gap-2 mt-1 text-caption text-muted-foreground" role="status">
            {t('Mixed')}
            <Button
              variant="link"
              size="xs"
              className="min-h-0 p-0 text-caption text-brand underline"
              type="button"
              onClick={markBoth}
            >
              {t('Use this value for all')}
            </Button>
          </span>
        ) : null}
      </span>
      <Dropdown
        label={t(LIMIT_CHOICE_TITLE)}
        value={mixed ? MIXED : choice}
        options={mixed ? [{ value: MIXED, label: t('Mixed'), disabled: true }, ...options] : options}
        disabled={busy || unsupported}
        onChange={(next) => {
          markBoth()
          onChange(withLimitChoice(draft, next as LimitChoice))
        }}
      />
    </SettingsRow>
  )
}
