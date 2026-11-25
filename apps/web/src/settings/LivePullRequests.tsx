import { useCallback, useEffect, useState } from 'react'
import type { LivePullRequestRepo, LivePullRequestStatus } from '@ramu/shared/types'
import { SettingsLabel, SettingsRow } from '@/components/settings-row'
import { Switch } from '@/components/ui/switch'
import { t, useLanguage } from '../i18n'
import { timeAgo } from '../Menu'
import { errorText } from '../lib/errors'
import { bridge, invoke as openOnThisComputer } from '../ipc'
import { ExternalLink } from 'lucide-react'
import { Button } from '@/components/desktop-button'
import { RAMU_GITHUB_APP_INSTALL_URL } from '@ramu/shared/pullRequestEvents'
import { useSettingsInvoke, useSingleSettingsHost } from './SettingsScope'

const connectionText: Record<LivePullRequestStatus['app'], string | null> = {
  off: null,
  connected: null,
  connecting: 'Connecting to Ramu Link for the GitHub App’s updates…',
  'signed-out': 'Sign in to your Ramu account to get the GitHub App’s updates.',
  unavailable: 'Ramu Link cannot be reached right now; Ramu keeps trying.',
}

/** What a repository's row says: where its updates come from, or what is missing. */
function repoText(repo: LivePullRequestRepo): string {
  const via = repo.source === 'app' ? t('Live via the Ramu GitHub App') : t('Live via a webhook')
  if (repo.state === 'live')
    return repo.lastDelivery ? `${via} · ${t('last update {0}', { 0: timeAgo(repo.lastDelivery) })}` : via
  if (repo.app === 'no-access') return t('Your GitHub account here cannot read it')
  if (repo.state === 'problem' && repo.problem) return t(problemText[repo.problem])
  return t('Adding…')
}

const problemText: Record<NonNullable<LivePullRequestRepo['problem']>, string> = {
  'needs-admin': 'Needs admin rights on the repository to add its webhook',
  'no-address': 'GitHub cannot reach this computer yet',
  failed: 'GitHub refused the webhook; Ramu tries again later',
}

/**
 * Live pull request updates for this computer: through the Ramu GitHub App where it is installed, else a webhook on the
 * repository, so a review, a finished check or a merge shows at once. Each repository says where its updates come from
 * or what is missing, and one without either offers installing the App.
 */
export function LivePullRequestsSetting() {
  useLanguage()
  const invoke = useSettingsInvoke()
  const single = useSingleSettingsHost()
  const [status, setStatus] = useState<LivePullRequestStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(
    () =>
      void invoke('forge.livePullRequests').then(
        (next) => setStatus(next),
        () => setStatus(null),
      ),
    [invoke],
  )
  useEffect(() => {
    if (!single) return
    load()
    // The host announces deliveries and webhook changes with the pull request reads.
    return bridge.on('forge:changed', load)
  }, [single, load])
  if (!single || !status) return null
  const toggle = async (enabled: boolean) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await invoke('forge.setLivePullRequests', enabled))
    } catch (cause) {
      setError(errorText(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <SettingsRow>
        <SettingsLabel
          title={t('Live pull request updates')}
          help={t(
            'Reviews, finished checks and merges show at once instead of at the next check. Uses the Ramu GitHub App where it is installed, and otherwise adds a webhook to the repository, which needs admin rights there and a public address for this computer (Ramu Link).',
          )}
        />
        <Switch
          aria-label={t('Live pull request updates')}
          checked={status.enabled}
          disabled={busy}
          onCheckedChange={(checked) => void toggle(checked)}
        />
      </SettingsRow>
      {error && (
        <p className="m-0 text-caption text-bad" role="alert">
          {error}
        </p>
      )}
      {status.enabled && connectionText[status.app] && (
        <p className="m-0 text-caption text-muted-foreground">{t(connectionText[status.app]!)}</p>
      )}
      {status.enabled && status.repos.some((repo) => repo.state !== 'live') && (
        // A repository with neither source gets one from the App, which needs no admin rights and no public address.
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 min-w-0 flex-1 basis-64 text-caption text-muted-foreground">
            {t(
              'Install the Ramu GitHub App on the repositories that are not live yet. It only reads pull requests, checks and statuses, and needs no admin rights on the repository.',
            )}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void openOnThisComputer('app.openExternal', RAMU_GITHUB_APP_INSTALL_URL)}
          >
            {t('Install the GitHub App')}
            <ExternalLink data-icon="inline-end" />
          </Button>
        </div>
      )}
      {status.enabled && status.repos.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-caption" aria-label={t('Repositories')}>
          {status.repos.map((repo) => (
            <li key={repo.slug} className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-soft">{repo.name}</span>
              <span className={repo.state === 'problem' ? 'text-warn' : 'text-muted-foreground'}>{repoText(repo)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
