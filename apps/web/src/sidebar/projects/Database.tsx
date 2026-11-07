import { useEffect, useState } from 'react'
import type { ProjectResources, ResourceProvider } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

/**
 * The Deploy sheet's database: Provision when the project needs one, then where it lives and the variables it sets.
 * Deleting it is done on the provider's page, never here.
 */
export function DatabaseSection({
  projectId,
  repoId,
  onProvisioned,
}: {
  projectId: string
  repoId: string | null
  onProvisioned: () => void
}) {
  useLanguage()
  const host = useHost()
  const [status, setStatus] = useState<{ repoId: string; value: ProjectResources } | null>(null)
  const [provider, setProvider] = useState<ResourceProvider | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!repoId) return
    let current = true
    host.invoke('deploy.resources', projectId, repoId).then(
      (value) => current && setStatus({ repoId, value }),
      (reason) => current && setError(errorText(reason)),
    )
    return () => {
      current = false
    }
  }, [host, projectId, repoId])
  const shown = status?.repoId === repoId ? status.value : null
  if (!repoId || !shown || (!shown.needsDatabase && !shown.resources.length)) return null
  const chosen = shown.providers.find((entry) => entry.provider === (provider ?? shown.providers[0]?.provider))
  const provision = async () => {
    if (!chosen?.plans[0]) return
    setBusy(true)
    setError(null)
    try {
      setStatus({
        repoId,
        value: await host.invoke('deploy.provision', projectId, repoId, chosen.provider, chosen.plans[0].id),
      })
      onProvisioned()
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t('Database')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong>{t('Database')}</strong>
      {shown.resources.length ? (
        shown.resources.map((resource) => (
          <div key={resource.id} className="flex flex-col gap-1 text-caption">
            <span className="flex items-center gap-2">
              <BrandIcon brand={resource.provider} />
              <span className="flex-1 text-foreground">
                {t('Postgres on {0} · {1}', {
                  0: shown.providers.find((entry) => entry.provider === resource.provider)?.name ?? resource.provider,
                  1: resource.name,
                })}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void openOnThisComputer('app.openExternal', resource.page)}
              >
                {t('Open')}
              </Button>
            </span>
            <span className="text-muted-foreground">
              {resource.previewBranch
                ? t(
                    'Production uses the main branch. Previews, this host and CI use a preview branch, so they never change production data. Sync below sets {0}.',
                    { 0: resource.variables.join(', ') },
                  )
                : t('Sync below sets {0}.', { 0: resource.variables.join(', ') })}
            </span>
            {shown.migrate && (
              <span className="text-muted-foreground">
                {t('Before each production deploy from Ramu, {0} runs against the production database.', {
                  0: shown.migrate,
                })}
              </span>
            )}
          </div>
        ))
      ) : (
        <>
          <p className="text-caption text-muted-foreground">
            {t(
              'This app stores data. Provision creates a Postgres database on your own account, with a separate branch for previews and development.',
            )}
          </p>
          <div role="radiogroup" aria-label={t('Database provider')} className="flex flex-col gap-0.5">
            {shown.providers.map((entry) => (
              <RowButton
                key={entry.provider}
                role="radio"
                aria-checked={chosen?.provider === entry.provider}
                aria-pressed={chosen?.provider === entry.provider}
                onClick={() => setProvider(entry.provider)}
              >
                <BrandIcon brand={entry.provider} />
                <span className="flex-1 text-foreground">{entry.name}</span>
                <span className="text-caption text-muted-foreground">
                  {entry.connected && entry.plans[0]
                    ? t(entry.plans[0].summary)
                    : t('Connect it in Settings → Git → Hosting accounts')}
                </span>
              </RowButton>
            ))}
          </div>
          <span>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy || !chosen?.connected}
              onClick={() => void provision()}
            >
              {busy ? t('Working…') : t('Provision')}
            </Button>
          </span>
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
