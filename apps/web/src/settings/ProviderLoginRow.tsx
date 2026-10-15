import { Button } from '@/components/desktop-button'
import { Switch } from '@/components/ui/switch'
import { LogIn } from 'lucide-react'
import type { ProviderStatus } from '@ramu/shared/providers'
import type { AgentProvider } from '@ramu/shared/types'
import { t } from '../i18n'
import { SettingsField } from './SettingsScope'
import { peakUsage, usageTone, type useAccountUsage } from './Usage'
import { SECONDARY_BUTTON_CLASS } from './constants'

export type LoginRow = { id: string; name: string; enabled?: boolean }

export function ProviderLoginRow({
  provider,
  row,
  state,
  accountUsage,
  signingIn,
  onLogin,
  onToggleAccount,
}: {
  provider: AgentProvider
  row: LoginRow
  state: NonNullable<ProviderStatus['signIn']>[string] | undefined
  accountUsage: ReturnType<typeof useAccountUsage>
  signingIn: boolean
  onLogin: () => void
  onToggleAccount: (enabled: boolean) => void
}) {
  const peak = state?.signedIn
    ? peakUsage(
        accountUsage.filter((reading) => (reading.accountId ?? 'default') === row.id),
        provider,
      )
    : undefined
  return (
    <li className="flex items-center gap-2.5 min-w-0">
      <span className="grow flex-1 min-w-0 text-left truncate">
        {row.name}
        <span className={`block small text-caption ${state?.signedIn ? 'text-brand' : 'muted text-muted-foreground'}`}>
          {!state
            ? ''
            : state.signedIn
              ? `${t('Signed in')}${state.detail && provider !== 'opencode' ? ` · ${state.detail}` : ''}`
              : t('Not signed in')}
        </span>
      </span>
      {peak && (
        <span
          className={`flex-none tabular-nums small text-caption ${usageTone(peak) === 'bad' ? 'text-bad' : usageTone(peak) === 'warn' ? 'text-warn' : 'text-soft'}`}
          title={t('Highest usage window for {0}', { '0': row.name })}
        >
          {peak.status === 'limited' ? t('Limited') : `${peak.usedPercent}%`}
        </span>
      )}
      <Button variant="secondary" size="sm" className={SECONDARY_BUTTON_CLASS} disabled={signingIn} onClick={onLogin}>
        <LogIn size={14} />
        {signingIn ? t('Finish sign-in in your browser…') : state?.signedIn ? t('Switch login') : t('Login')}
      </Button>
      {row.id !== 'default' && (
        <SettingsField path={`providerBinaries.${provider}.accounts`}>
          {' '}
          <Switch
            aria-label={t('Turn account {0} on or off', { '0': row.name })}
            checked={row.enabled !== false}
            onCheckedChange={onToggleAccount}
          />{' '}
        </SettingsField>
      )}
    </li>
  )
}
