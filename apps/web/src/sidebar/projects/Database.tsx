import { useEffect, useState } from 'react'
import { RESOURCE_KINDS, type ProjectResources, type ResourceKind, type ResourceProvider } from '@ramu/shared/types'
import { BrandIcon } from '@/components/brand-icon'
import { Button } from '@/components/desktop-button'
import { RowButton } from '@/components/row-button'
import { t, useLanguage } from '../../i18n'
import { invoke as openOnThisComputer } from '../../ipc'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

/** Each kind's words, as translation keys. */
const WORDS: Record<ResourceKind, { title: string; made: string; preview: string; offer: string }> = {
  database: {
    title: 'Database',
    made: 'Postgres on {0} · {1}',
    preview:
      'Production has its own database. Previews, this host and CI use a separate preview copy (a Neon branch, or a second Supabase project), so they never change production data. Sync below sets {0}.',
    offer:
      'This app stores data. Provision creates a Postgres database on your own account, with a separate copy for previews and development.',
  },
  cache: {
    title: 'Cache',
    made: 'Redis on {0} · {1}',
    preview:
      'Production has its own Redis database. Previews, this host and CI use a second one, so they never read or clear production’s keys. Sync below sets {0}.',
    offer:
      'This app uses Redis. Provision creates a Redis database on your own account, with a second one for previews and development.',
  },
  email: {
    title: 'Email',
    made: 'Email sending on {0} · {1}',
    preview:
      'Production and previews each get their own sending-only key, so neither can manage the account. Sync below sets {0}.',
    offer:
      'This app sends email. Provision creates sending-only keys on your own account: one for production, one for previews and development.',
  },
}

/**
 * The Deploy sheet's resources: for each kind the project needs (a database, a cache, email), Provision, then where it
 * lives and the variables it sets. Deleting one is done on the provider's page, never here.
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
  if (!repoId) return null
  const kinds = shown
    ? RESOURCE_KINDS.filter(
        (kind) => shown.needs.includes(kind) || shown.resources.some((resource) => resource.kind === kind),
      )
    : []
  if (!kinds.length && !error) return null
  return (
    <>
      {shown &&
        kinds.map((kind) => (
          <KindSection
            key={kind}
            kind={kind}
            shown={shown}
            provision={async (provider, plan) => {
              setStatus({ repoId, value: await host.invoke('deploy.provision', projectId, repoId, provider, plan) })
              onProvisioned()
            }}
          />
        ))}
      {error && (
        <p role="alert" className="text-caption text-destructive">
          {error}
        </p>
      )}
    </>
  )
}

function KindSection({
  kind,
  shown,
  provision,
}: {
  kind: ResourceKind
  shown: ProjectResources
  provision: (provider: ResourceProvider, plan: string) => Promise<void>
}) {
  const [provider, setProvider] = useState<ResourceProvider | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const words = WORDS[kind]
  const providers = shown.providers.filter((entry) => entry.kind === kind)
  const made = shown.resources.filter((resource) => resource.kind === kind)
  const chosen = providers.find((entry) => entry.provider === (provider ?? providers[0]?.provider))
  const start = async () => {
    if (!chosen?.plans[0]) return
    setBusy(true)
    setError(null)
    try {
      await provision(chosen.provider, chosen.plans[0].id)
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section aria-label={t(words.title)} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong>{t(words.title)}</strong>
      {made.length ? (
        made.map((resource) => (
          <div key={resource.id} className="flex flex-col gap-1 text-caption">
            <span className="flex items-center gap-2">
              <BrandIcon brand={resource.provider} />
              <span className="flex-1 text-foreground">
                {t(words.made, {
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
                ? t(words.preview, { 0: resource.variables.join(', ') })
                : t('Sync below sets {0}.', { 0: resource.variables.join(', ') })}
            </span>
            {kind === 'database' && shown.migrate && (
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
          <p className="text-caption text-muted-foreground">{t(words.offer)}</p>
          <div role="radiogroup" aria-label={t('Provider')} className="flex flex-col gap-0.5">
            {providers.map((entry) => (
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
            <Button size="sm" variant="secondary" disabled={busy || !chosen?.connected} onClick={() => void start()}>
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
