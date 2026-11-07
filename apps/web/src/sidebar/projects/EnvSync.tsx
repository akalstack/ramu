import { useEffect, useState } from 'react'
import { Check, Minus } from 'lucide-react'
import type { EnvColumn, EnvEnvironment, EnvSyncStatus } from '@ramu/shared/envSync'
import { Button } from '@/components/desktop-button'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

const ENVIRONMENT: Record<EnvEnvironment, string> = {
  development: 'Development',
  ci: 'CI',
  preview: 'Preview',
  production: 'Production',
}

const heading = (column: EnvColumn) =>
  column.target === 'host' ? t('This host') : `${column.name} · ${t(ENVIRONMENT[column.environment])}`

/** Places that can be read and lack a variable this host has a value for: what Sync would write. */
function pending(status: EnvSyncStatus): number {
  const onHost = new Set(status.columns.find((column) => column.target === 'host')?.names ?? [])
  return status.columns
    .filter((column) => column.target !== 'host' && column.names)
    .reduce(
      (sum, column) =>
        sum + status.variables.filter((name) => onHost.has(name) && !column.names!.includes(name)).length,
      0,
    )
}

/**
 * The Deploy sheet's environment variables: the names the app reads next to where each is set, and Sync, which copies
 * the values this host has to the places that lack them. Values are never shown.
 */
export function EnvSyncSection({ projectId, repoId }: { projectId: string; repoId: string | null }) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<{ repoId: string; value: EnvSyncStatus } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!repoId) return
    let current = true
    host.invoke('deploy.environment', projectId, repoId).then(
      (value) => current && setStatus({ repoId, value }),
      (reason) => current && setError(errorText(reason)),
    )
    return () => {
      current = false
    }
  }, [host, projectId, repoId])
  const shown = status?.repoId === repoId ? status.value : null
  if (!repoId) return null
  const sync = async () => {
    setBusy(true)
    setError(null)
    try {
      setStatus({ repoId, value: await host.invoke('deploy.syncEnvironment', projectId, repoId) })
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  const toWrite = shown ? pending(shown) : 0
  return (
    <section aria-label={t('Environment variables')} className="mt-3 flex flex-col gap-1 border-t border-(--line) pt-3">
      <strong>{t('Environment variables')}</strong>
      {!shown ? (
        !error && <p className="text-caption text-muted-foreground">{t('Checking…')}</p>
      ) : !shown.variables.length ? (
        <p className="text-caption text-muted-foreground">
          {t('The app reads no environment variables in .env.example or its code.')}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-caption">
              <thead>
                <tr>
                  <th scope="col" className="text-left font-normal text-muted-foreground">
                    {t('Name')}
                  </th>
                  {shown.columns.map((column) => (
                    <th
                      key={`${column.target}:${column.environment}`}
                      scope="col"
                      className="px-1 text-center font-normal text-muted-foreground"
                      title={column.error ?? undefined}
                    >
                      {heading(column)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.variables.map((name) => (
                  <tr key={name}>
                    <th scope="row" className="text-left font-mono font-normal">
                      {name}
                    </th>
                    {shown.columns.map((column) => {
                      const set = column.names?.includes(name)
                      return (
                        <td key={`${column.target}:${column.environment}`} className="px-1 text-center">
                          {column.names === null ? (
                            <span className="text-muted-foreground">?</span>
                          ) : set ? (
                            <Check size={12} aria-label={t('Set')} className="inline" />
                          ) : (
                            <Minus size={12} aria-label={t('Not set')} className="inline text-muted-foreground" />
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {shown.columns
            .filter((column) => column.error)
            .filter((column, index, all) => all.findIndex((other) => other.target === column.target) === index)
            .map((column) => (
              <p key={column.target} className="text-caption text-destructive">
                {column.error}
              </p>
            ))}
          {shown.missingOnHost.length > 0 && (
            <p className="text-caption text-muted-foreground">
              {t('This host has no value for {0}. Add it in Settings → Environment variables, then sync.', {
                0: shown.missingOnHost.join(', '),
              })}
            </p>
          )}
          {toWrite > 0 && (
            <span>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => void sync()}>
                {busy ? t('Working…') : t('Sync')}
              </Button>
            </span>
          )}
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
