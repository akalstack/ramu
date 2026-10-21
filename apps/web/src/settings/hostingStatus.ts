import type { ForgeCliAccount, ForgeConnectionSummary } from '@ramu/shared/types'
import { t } from '../i18n'

export function connectionHeadline(summary: ForgeConnectionSummary | null, failed: boolean): string {
  if (failed) return t('Could not check GitHub on this host.')
  if (!summary) return t('Checking…')
  if (summary.cli === 'no-cli') return t('GitHub CLI not installed on this host.')
  if (summary.cli === 'signed-out') return t('Not signed in to GitHub on this host.')
  const active = summary.accounts.find((account) => account.active && account.state === 'ok')
  const usable = active ?? summary.accounts.find((account) => account.state === 'ok')
  return usable
    ? t('Connected as {0} on {1} (GitHub CLI)', { '0': usable.login, '1': usable.host })
    : t('The GitHub CLI sign-in has expired.')
}

export function accountDetail(account: ForgeCliAccount): string {
  return [
    account.state === 'invalid' ? t('Expired or revoked. Run gh auth login on this host.') : null,
    account.active ? t('In use') : null,
    account.protocol ? t('Git over {0}', { '0': account.protocol.toUpperCase() }) : null,
    account.scopes.length ? t('Permissions: {0}', { '0': account.scopes.join(', ') }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
}
