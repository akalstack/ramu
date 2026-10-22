import { useEffect, useRef, useState } from 'react'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { Dropdown } from '../Menu'
import { t } from '../i18n'
import { invokerFor } from '../ipc'
import { errorText } from '../lib/errors'
import { cloneProgressText, useClone } from './useClone'

/** The folder name a clone gets: the repository name, restricted to what a single folder name allows. */
export const cloneFolderName = (fullName: string) =>
  (fullName.split('/').at(-1) ?? fullName).replace(/[^A-Za-z0-9._-]/g, '-')

/**
 * Finds a GitHub repository the host's account can see (or one pasted as owner/name) and clones it into the folder
 * being browsed on that host. The clone runs on the host with its own Git credentials; a failed clone keeps its
 * folder so it can be inspected.
 */
export function CloneFromGitHub({
  host,
  parent,
  onCloned,
}: {
  host: string
  parent: string
  onCloned: (path: string) => void
}) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ForgeRepositorySummary[] | null>(null)
  const [busy, setBusy] = useState<'search' | 'clone' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const request = useRef(0)
  const cloning = useClone(host)
  const [origin, setOrigin] = useState('github.com')
  const [origins, setOrigins] = useState<string[]>(['github.com'])

  // Another host or folder starts a fresh search; a late answer for the old one is dropped.
  useEffect(() => {
    ++request.current
    setResults(null)
    setError(null)
    setBusy(null)
    setOrigin('github.com')
    // Enterprise servers appear once this host has a saved token for them.
    void invokerFor(host)('forge.connections').then(
      (summary) =>
        setOrigins([
          'github.com',
          ...new Set((summary.saved ?? []).filter((c) => c.enabled && c.origin !== 'github.com').map((c) => c.origin)),
        ]),
      () => setOrigins(['github.com']),
    )
  }, [host])

  const find = async () => {
    const mine = ++request.current
    setBusy('search')
    setError(null)
    try {
      const found =
        origin === 'github.com'
          ? await invokerFor(host)('forge.searchRepositories', search.trim())
          : await invokerFor(host)('forge.searchRepositories', search.trim(), origin)
      if (mine === request.current) setResults(found)
    } catch (reason) {
      if (mine === request.current) setError(errorText(reason))
    } finally {
      if (mine === request.current) setBusy(null)
    }
  }

  const clone = async (repository: ForgeRepositorySummary) => {
    setBusy('clone')
    setError(null)
    try {
      onCloned(await cloning.run(parent, cloneFolderName(repository.fullName), repository.cloneUrl))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section aria-label={t('Clone from GitHub')} className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
      <strong className="text-caption">{t('Clone from GitHub')}</strong>
      {origins.length > 1 && (
        <Dropdown
          label={t('GitHub server')}
          value={origin}
          options={origins.map((value) => ({ value, label: value }))}
          onChange={(value) => {
            setOrigin(value)
            setResults(null)
          }}
        />
      )}
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void find()
        }}
      >
        <Input
          aria-label={t('Search your repositories or enter owner/name')}
          placeholder={t('Search your repositories or enter owner/name')}
          value={search}
          maxLength={200}
          disabled={busy !== null}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={busy !== null}>
          {busy === 'search' ? t('Searching…') : t('Search')}
        </Button>
      </form>
      {error && (
        <p role="alert" className="m-0 text-caption text-destructive">
          {error}
        </p>
      )}
      {busy === 'clone' && cloning.canCancel && (
        <Button variant="secondary" size="sm" className="self-start" onClick={cloning.cancel}>
          {t('Cancel clone')}
        </Button>
      )}
      {results && !results.length && (
        <p className="m-0 text-caption text-muted-foreground">{t('No repositories found')}</p>
      )}
      {results && results.length > 0 && (
        <ul
          className="m-0 flex max-h-[200px] list-none flex-col gap-0.5 overflow-y-auto p-0"
          aria-label={t('Repositories')}
        >
          {results.map((repository) => (
            <li key={repository.fullName} className="flex items-center gap-2">
              <span className="min-w-0 flex-1" title={repository.description ?? undefined}>
                <span className="block truncate">{repository.fullName}</span>
                {repository.private && <span className="text-caption text-muted-foreground">{t('Private')}</span>}
              </span>
              <Button variant="ghost" size="sm" disabled={busy !== null} onClick={() => void clone(repository)}>
                {busy === 'clone' ? cloneProgressText(cloning.progress, t) : t('Clone')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 text-caption text-muted-foreground">
        {t(
          'The host clones into this folder with its own Git credentials. A failed clone keeps its folder to inspect.',
        )}
      </p>
    </section>
  )
}
