import { Button } from '@/components/desktop-button'
import { Plus } from 'lucide-react'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'
import { SECONDARY_BUTTON_CLASS } from './constants'

export type ProviderPrefs = NonNullable<AppPreferences['providerBinaries'][AgentProvider]>

export const PROVIDER_ACTIONS_CLASS = 'provider-settings-actions flex items-center gap-2.5 flex-wrap'

/** Adds a login straight away; it is named by its sign-in email unless the person renames it. */
export function ProviderAddAccount({
  preferences,
  onAdd,
}: {
  preferences: ProviderPrefs | undefined
  onAdd: () => void
}) {
  return (
    <div className={PROVIDER_ACTIONS_CLASS}>
      <Button
        variant="secondary"
        size="sm"
        className={`${SECONDARY_BUTTON_CLASS} small text-caption`}
        disabled={(preferences?.accounts?.length ?? 0) >= 20}
        onClick={onAdd}
      >
        <Plus size={14} />
        {t('Add account')}
      </Button>
    </div>
  )
}
