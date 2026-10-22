import { useEffect, useRef, useState } from 'react'
import type { ForgeAccessReport } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'
import { accessLines } from '../../settings/hostingStatus'

/** Opens Settings → Git at the GitHub row; the Settings dialog closes back onto this repository. */
export function openGitHubSettings() {
  window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'git', target: 'GitHub' } }))
}

/**
 * Where this repository's GitHub access stands, one line per capability, from a read-only check on the host: it makes
 * no commit and no push. A missing piece links to the Settings row that fixes it.
 */
export function RepositoryAccess({ taskId, repoId }: { taskId: string; repoId: string }) {
  useLanguage()
  const { invoke, id: hostId } = useHost()
  const [report, setReport] = useState<ForgeAccessReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  useEffect(() => {
    // A different checkout or host has its own access: drop the old answer and ignore a late reply.
    ++request.current
    setReport(null)
    setError(null)
    setBusy(false)
  }, [hostId, taskId, repoId])
  const check = async () => {
    const mine = ++request.current
    setBusy(true)
    setError(null)
    try {
      const next = await invoke('forge.checkAccess', taskId, repoId)
      if (mine === request.current) setReport(next)
    } catch (reason) {
      if (mine === request.current) setError(errorText(reason))
    } finally {
      if (mine === request.current) setBusy(false)
    }
  }
  const lines = report ? accessLines(report) : []
  const needsSetup = !!report && (report.account.source === 'none' || report.api.read.state !== 'ok')
  return (
    <div className="flex flex-col gap-1.5 text-caption">
      <span className="flex flex-wrap gap-1.5">
        <Button variant="ghost" size="sm" aria-busy={busy} disabled={busy} onClick={() => void check()}>
          {busy ? t('Checking…') : t('Check access')}
        </Button>
        {needsSetup && (
          <Button variant="ghost" size="sm" onClick={openGitHubSettings}>
            {t('Open GitHub settings')}
          </Button>
        )}
      </span>
      {error && (
        <p role="alert" className="m-0 text-destructive">
          {error}
        </p>
      )}
      {report && (
        <dl role="status" className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-muted-foreground">
          {lines.map((line) => (
            <div key={line.label} className="contents">
              <dt>{line.label}</dt>
              <dd className="m-0 min-w-0 break-words text-foreground">{line.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
