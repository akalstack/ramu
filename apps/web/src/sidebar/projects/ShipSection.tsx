import { useEffect, useState } from 'react'
import {
  FINISH_LINES,
  FINISH_LINE_LABEL,
  reachableFinishLines,
  shipExplanation,
  type FinishLine,
} from '@ramu/shared/ship'
import type { ShipProjectStatus } from '@ramu/shared/types/ship'
import { Dropdown } from '../../Menu'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

const SUGGESTED = 'suggested'

/**
 * The Live app sheet's finish line: how far an agent asked to ship carries a change on its own. Ramu suggests one from
 * the repository, and a limit committed in the repository's `ramu.json` keeps later lines out of reach.
 */
export function ShipSection({ projectId }: { projectId: string }) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<ShipProjectStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    host.invoke('ship.project', projectId).then(
      (value) => current && setStatus(value),
      (reason) => current && setError(errorText(reason)),
    )
    return () => {
      current = false
    }
  }, [host, projectId])
  const choose = async (value: string) => {
    setBusy(true)
    setError(null)
    try {
      setStatus(await host.invoke('ship.setFinishLine', projectId, value === SUGGESTED ? null : (value as FinishLine)))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  if (!status && !error) return null
  const reachable = status ? reachableFinishLines(status) : []
  return (
    <section aria-label={t('Ship')} className="flex flex-col gap-2 border-b border-(--line) pb-3">
      <strong>{t('Ship')}</strong>
      {status && (
        <>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-caption text-muted-foreground">{t('Finish line')}</span>
            <Dropdown
              label={t('Finish line')}
              disabled={busy}
              value={status.chosen ?? SUGGESTED}
              onChange={(value) => void choose(value)}
              options={[
                {
                  value: SUGGESTED,
                  label: t('Suggested: {0}', { 0: t(FINISH_LINE_LABEL[status.suggested]) }),
                },
                ...FINISH_LINES.map((line) => ({
                  value: line,
                  label: t(FINISH_LINE_LABEL[line]),
                  disabled: !reachable.includes(line),
                })),
              ]}
            />
          </div>
          {shipExplanation(status, t).map((line) => (
            <p key={line} className="m-0 text-caption text-muted-foreground">
              {line}
            </p>
          ))}
        </>
      )}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
