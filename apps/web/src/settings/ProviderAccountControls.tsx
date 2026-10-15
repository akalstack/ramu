import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { Plus } from 'lucide-react'
import { providerName } from '@ramu/shared/providers/providers'
import type { AgentProvider, AppPreferences } from '@ramu/shared/types'
import { t } from '../i18n'
import { Dropdown } from '../Menu'
import { SettingsField } from './SettingsScope'
import { SECONDARY_BUTTON_CLASS } from './constants'

export type ProviderPrefs = NonNullable<AppPreferences['providerBinaries'][AgentProvider]>

export const PROVIDER_ACTIONS_CLASS = 'provider-settings-actions flex items-center gap-2.5 flex-wrap'

// Account picker with an "Add account" button.
export function ProviderAccountPicker({
  provider,
  preferences,
  onSelect,
  onAdd,
}: {
  provider: AgentProvider
  preferences: ProviderPrefs | undefined
  onSelect: (accountId: string) => void
  onAdd: () => void
}) {
  return (
    <div className={PROVIDER_ACTIONS_CLASS}>
      <SettingsField path={`providerBinaries.${provider}.accountId`}>
        {' '}
        <Dropdown
          label={t('{0} account', { '0': providerName(provider) })}
          value={preferences?.accountId ?? 'default'}
          options={[
            { value: 'default', label: t(provider === 'antigravity' ? 'Default account' : 'Default CLI account') },
            ...(preferences?.accounts ?? [])
              .filter((account) => account.enabled !== false)
              .map((account) => ({ value: account.id, label: account.name })),
          ]}
          onChange={onSelect}
        />{' '}
      </SettingsField>
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

export function ProviderAddAccountForm({
  name,
  onName,
  onAdd,
  onCancel,
}: {
  name: string
  onName: (name: string) => void
  onAdd: () => void
  onCancel: () => void
}) {
  return (
    <div className={PROVIDER_ACTIONS_CLASS}>
      <Input
        aria-label={t('Account name')}
        placeholder={t('Account name')}
        value={name}
        maxLength={80}
        onChange={(event) => onName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            onAdd()
          }
        }}
      />
      <Button variant="secondary" className={SECONDARY_BUTTON_CLASS} disabled={!name.trim()} onClick={onAdd}>
        {t('Add')}
      </Button>
      <Button variant="ghost" onClick={onCancel}>
        {t('Cancel')}
      </Button>
    </div>
  )
}
