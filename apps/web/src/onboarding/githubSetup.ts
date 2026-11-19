import type { ForgeConnectionSummary } from '@ramu/shared/types'

/**
 * What the Identities step offers for GitHub: nothing more once an account works, a terminal sign-in when the GitHub
 * CLI is installed but has no working account, and the CLI's setup page when it is missing and no token is saved.
 */
export type GithubSetup = 'ready' | 'sign-in' | 'install'

export function githubSetup(summary: ForgeConnectionSummary): GithubSetup {
  const chosen = summary.saved.find((connection) => connection.selected && connection.enabled)
  if (chosen?.state === 'connected') return 'ready'
  if (summary.cli === 'signed-in' && summary.accounts.some((account) => account.state === 'ok')) return 'ready'
  return summary.cli === 'no-cli' ? 'install' : 'sign-in'
}
