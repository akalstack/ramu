import { useEffect, useState } from 'react'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { t, useLanguage } from '../../i18n'
import { errorText } from '../../lib/errors'
import { useHost } from '../../workspace/HostProvider'

/**
 * The Live app sheet's production database: the address a production deploy's migrations run against, saved on the
 * host and never shown again. It can be replaced or forgotten, and the sheet says which migrate command runs.
 */
export function ProductionDatabaseSection({ projectId }: { projectId: string }) {
  useLanguage()
  const host = useHost()
  const [plan, setPlan] = useState<{ command: string | null; addressSaved: boolean } | null>(null)
  const [editing, setEditing] = useState(false)
  const [address, setAddress] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let current = true
    host.invoke('deploy.migrations', projectId).then(
      (value) => current && setPlan(value),
      (reason) => current && setError(errorText(reason)),
    )
    return () => {
      current = false
    }
  }, [host, projectId])
  const save = async (value: string | null) => {
    setBusy(true)
    setError(null)
    try {
      await host.invoke('deploy.setProductionDatabase', projectId, value)
      setPlan(await host.invoke('deploy.migrations', projectId))
      setEditing(false)
      setAddress('')
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }
  if (!plan && !error) return null
  return (
    <section aria-label={t('Production database')} className="mt-3 flex flex-col gap-2 border-t border-(--line) pt-3">
      <strong>{t('Production database')}</strong>
      {plan && (
        <p className="m-0 text-caption text-muted-foreground" role="status">
          {plan.command
            ? t('Before each production deploy, Ramu runs {0} against this database.', { 0: plan.command })
            : t(
                'Add a migrate command to ramu.json, and Ramu runs it against this database before each production deploy.',
              )}{' '}
          {plan.addressSaved ? t('An address is saved on this computer.') : t('No address is saved yet.')}
        </p>
      )}
      {editing ? (
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (address.trim()) void save(address.trim())
          }}
        >
          <Input
            aria-label={t('Production database address')}
            className="flex-1"
            type="password"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            placeholder="postgres://"
            disabled={busy}
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={busy || !address.trim()}>
            {t('Save')}
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
            {t('Cancel')}
          </Button>
        </form>
      ) : (
        plan && (
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setEditing(true)}>
              {plan.addressSaved ? t('Replace address') : t('Add address')}
            </Button>
            {plan.addressSaved && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(null)}>
                {t('Forget')}
              </Button>
            )}
          </span>
        )
      )}
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
    </section>
  )
}
