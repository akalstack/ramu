import { useEffect, useRef, useState } from 'react'
import type { ForgeAccessReport, ForgeAvailability, ForgeConnectionSummary } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Dropdown } from '../../Menu'
import { t } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'
import { accessLines } from '../../settings/hostingStatus'

/** Opens Settings → Git at the hosting accounts. Closing Settings returns to the repository that asked. */
export const openHostingSettings = () =>
  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'git', target: 'Hosting accounts' } }))

/** Why pull requests are unavailable here, with the one action that fixes it. */
export function forgeUnavailableText(availability: ForgeAvailability): string {
  switch (availability) {
    case 'no-cli':
      return t(
        'Install the GitHub CLI (gh), or save a GitHub token in Settings, to open pull requests and follow their checks here.',
      )
    case 'choose-account':
      return t('Several GitHub accounts are saved for this server. Choose which one this repository uses.')
    default:
      return t('Sign in to GitHub with gh auth login, or save a GitHub token in Settings, to open pull requests here.')
  }
}

/** What a repository's account can do, checked on demand: API reads, writes and Git transport apart, nothing pushed. */
export function ForgeAccessPanel({
  taskId,
  repoId,
  unavailable,
}: {
  taskId: string
  repoId: string
  unavailable?: ForgeAvailability
}) {
  const { invoke } = useHost()
  const [report, setReport] = useState<ForgeAccessReport | null>(null)
  const [summary, setSummary] = useState<ForgeConnectionSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)

  // A different repository or host has its own report; never show the previous one.
  useEffect(() => {
    setReport(null)
    setSummary(null)
    setError(null)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- a counter that invalidates in-flight work; it is not a DOM ref
      ++request.current
    }
  }, [taskId, repoId, invoke])

  const check = async () => {
    const mine = ++request.current
    setBusy(true)
    setError(null)
    try {
      const [next, accounts] = await Promise.all([
        invoke('forge.checkAccess', taskId, repoId),
        invoke('forge.connections').catch(() => null),
      ])
      if (mine !== request.current) return
      setReport(next)
      setSummary(accounts)
    } catch (reason) {
      if (mine === request.current) setError(errorText(reason))
    } finally {
      if (mine === request.current) setBusy(false)
    }
  }

  const choices = report?.origin
    ? [
        ...(summary?.saved ?? [])
          .filter((connection) => connection.origin === report.origin && connection.enabled)
          .map((connection) => ({
            value: connection.id,
            label: t('Saved token for {0}', { '0': connection.login ?? connection.origin }),
          })),
        ...(summary?.accounts ?? [])
          .filter((account) => account.host === report.origin && account.state === 'ok')
          .map((account) => ({
            value: `cli:${account.login}`,
            label: t('GitHub CLI account {0}', { '0': account.login }),
          })),
      ]
    : []
  const chosen =
    report?.account.connectionId ??
    (report?.account.source === 'cli' && report.account.login ? `cli:${report.account.login}` : '')

  const choose = async (account: string) => {
    setBusy(true)
    setError(null)
    try {
      await invoke('forge.setRepositoryAccount', taskId, repoId, account || null)
      window.dispatchEvent(new Event('ramu:git-updated'))
      await check()
    } catch (reason) {
      setError(errorText(reason))
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      {unavailable && <p className="m-0 text-caption text-muted-foreground">{forgeUnavailableText(unavailable)}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          className="small text-caption"
          aria-busy={busy}
          disabled={busy}
          onClick={() => void check()}
        >
          {busy ? t('Checking…') : t('Check access')}
        </Button>
        <Button variant="ghost" size="sm" className="small text-caption" onClick={openHostingSettings}>
          {t('Open GitHub settings')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
      {report && (
        <dl className="m-0 grid gap-x-2 gap-y-0.5 text-caption" role="status">
          {accessLines(report).map((line) => (
            <div key={line.label} className="flex flex-col">
              <dt className="text-muted-foreground">{line.label}</dt>
              <dd className="m-0">{line.text}</dd>
            </div>
          ))}
        </dl>
      )}
      {report && choices.length > 1 && summary?.canAdminister !== false && (
        <div className="flex flex-col gap-1 text-caption text-muted-foreground">
          <Dropdown
            label={t('Account for this repository')}
            placeholder={t('Choose an account')}
            value={chosen}
            options={choices}
            onChange={(value) => void choose(value)}
            disabled={busy}
          />
        </div>
      )}
    </div>
  )
}
