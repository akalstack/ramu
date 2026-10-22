import type {
  ForgeAccessReport,
  ForgeCheckResult,
  ForgeCliAccount,
  ForgeConnectionState,
  ForgeConnectionSummary,
  ForgeSavedConnection,
} from '@ramu/shared/types'
import { t } from '../i18n'

export function connectionHeadline(summary: ForgeConnectionSummary | null, failed: boolean): string {
  if (failed) return t('Could not check GitHub on this host.')
  if (!summary) return t('Checking…')
  const chosen = summary.saved?.find((connection) => connection.selected && connection.enabled)
  if (chosen?.state === 'connected')
    return t('Connected as {0} on {1} (saved token)', { '0': chosen.login ?? '', '1': chosen.origin })
  if (chosen) return t('The saved token for {0} needs attention.', { '0': chosen.origin })
  if (summary.cli === 'no-cli' && !summary.saved?.length) return t('GitHub CLI not installed on this host.')
  if (summary.cli === 'signed-out' && !summary.saved?.length) return t('Not signed in to GitHub on this host.')
  if (summary.cli === 'no-cli' || summary.cli === 'signed-out')
    return t('{0} saved connections are not in use.', { '0': String(summary.saved?.length ?? 0) })
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

/** Status in words, so it never depends on a colour or an icon. */
export function connectionStateText(state: ForgeConnectionState): string {
  switch (state) {
    case 'connected':
      return t('Connected')
    case 'unverified':
      return t('Not verified yet')
    case 'expired':
      return t('Expired or revoked')
    case 'missing-permission':
      return t('Missing permission')
    case 'rate-limited':
      return t('Rate limited')
    case 'offline':
      return t('Server unreachable')
    case 'unsupported-server':
      return t('Unsupported server')
  }
}

export function savedDetail(connection: ForgeSavedConnection): string {
  return [
    connectionStateText(connection.state),
    connection.enabled ? null : t('Disabled'),
    connection.selected ? t('Default for {0}', { '0': connection.origin }) : null,
    connection.verifiedAt ? t('Checked {0}', { '0': new Date(connection.verifiedAt).toLocaleString() }) : null,
    connection.scopes.length ? t('Permissions: {0}', { '0': connection.scopes.join(', ') }) : null,
    connection.detail,
  ]
    .filter(Boolean)
    .join(' · ')
}

const checkText = (result: ForgeCheckResult): string => {
  const state =
    result.state === 'ok'
      ? t('Works')
      : result.state === 'denied'
        ? t('Not allowed')
        : result.state === 'failed'
          ? t('Failed')
          : t('Not checked')
  return result.detail ? `${state}: ${result.detail}` : state
}

/** One line per capability, so a failing API does not hide a working Git transport or the other way around. */
export function accessLines(report: ForgeAccessReport): { label: string; text: string }[] {
  const who =
    report.account.source === 'saved'
      ? t('Saved token for {0}', { '0': report.account.login ?? report.origin ?? '' })
      : report.account.source === 'cli'
        ? report.account.login
          ? t('GitHub CLI account {0}', { '0': report.account.login })
          : t('GitHub CLI (active account)')
        : report.account.ambiguous
          ? t('Several accounts are saved. Choose one in Settings.')
          : t('None')
  return [
    { label: t('Account'), text: who },
    { label: t('Read through the API'), text: checkText(report.api.read) },
    { label: t('Open pull requests and push through the API'), text: checkText(report.api.write) },
    { label: t('Git transport (fetch)'), text: checkText(report.transport) },
  ]
}

/** Who a new repository is created for: the GitHub CLI's active account, since publishing runs through `gh`. */
export function publishAccount(summary: ForgeConnectionSummary): string | null {
  const active = summary.accounts.find((account) => account.active && account.state === 'ok')
  const usable = active ?? summary.accounts.find((account) => account.state === 'ok')
  return usable ? t('Publishing as {0} on {1}', { '0': usable.login, '1': usable.host }) : null
}
