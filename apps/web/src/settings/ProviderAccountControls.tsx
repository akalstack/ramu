import { useState } from 'react'
import { Button } from '@/components/desktop-button'
import { Plus } from 'lucide-react'
import { accountKey } from '@ramu/shared/identities'
import { providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'
import { IdentityDropdown, useAccountIdentities } from './AccountIdentity'
import { SECONDARY_BUTTON_CLASS } from './constants'

export type ProviderPrefs = NonNullable<AppPreferences['providerBinaries'][AgentProvider]>

export const PROVIDER_ACTIONS_CLASS = 'provider-settings-actions flex items-center gap-2.5 flex-wrap'

/**
 * Adds a login straight away; it is named by its sign-in email unless the person renames it. With two or more
 * identities the login is added for one of them, or for all, chosen beside the button.
 */
export function ProviderAddAccount({
  provider,
  preferences,
  onAdd,
}: {
  provider: AgentProvider
  preferences: ProviderPrefs | undefined
  /** `identityId` is '' for a login every identity may use. */
  onAdd: (identityId: string) => void
}) {
  const { identities, suggestedFor } = useAccountIdentities()
  // Null follows the suggestion, which is known only once the identities have loaded.
  const [chosen, setChosen] = useState<string | null>(null)
  const forIdentity = chosen ?? suggestedFor(accountKey('provider', provider))
  return (
    <div className={PROVIDER_ACTIONS_CLASS}>
      <Button
        variant="secondary"
        size="sm"
        className={`${SECONDARY_BUTTON_CLASS} small text-caption`}
        disabled={(preferences?.accounts?.length ?? 0) >= 20}
        onClick={() => {
          onAdd(identities ? forIdentity : '')
          setChosen(null)
        }}
      >
        <Plus size={14} />
        {t('Add account')}
      </Button>
      {identities && (
        <IdentityDropdown
          identities={identities}
          caption={t('For')}
          label={t('New {0} login for', { 0: providerName(provider) })}
          value={forIdentity}
          onChange={setChosen}
        />
      )}
    </div>
  )
}
