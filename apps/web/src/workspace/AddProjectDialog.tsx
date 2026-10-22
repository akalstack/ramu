import { t, useLanguage } from '../i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../Menu'
import { Folder, ChevronLeft, Lock } from 'lucide-react'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { invokerFor } from '../ipc'
import { ownHostId } from '../hosts'
import { errorText } from './TaskPane'
import { cloneProgressText, useClone } from './useClone'
import { onFolderPick, onRepoChoice, type FolderPick, type RepoChoice } from './addProject'

const name = (path: string) => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** Shown when a folder holds several repositories: every one starts ticked, and the user unticks any to leave out. */
export function AddProjectDialog() {
  return (
    <>
      <RepoChoiceDialog />
      <HostFolderDialog />
    </>
  )
}

function RepoChoiceDialog() {
  useLanguage()
  const [request, setRequest] = useState<RepoChoice | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  useEffect(
    () =>
      onRepoChoice((next) => {
        setSelected(new Set(next.repos))
        setRequest(next)
      }),
    [],
  )
  if (!request) return null
  const close = (result: string[] | null) => {
    const { resolve } = request
    setRequest(null)
    resolve(result)
  }
  const toggle = (repo: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(repo)) next.add(repo)
      return next
    })
  const chosen = request.repos.filter((repo) => selected.has(repo))
  const all = chosen.length === request.repos.length
  return (
    <Dialog
      title={t('Add {0}', { '0': request.name })}
      confirmLabel={
        chosen.length
          ? t('Add {0} of {1}', { '0': chosen.length, '1': request.repos.length })
          : t('Select a repository')
      }
      confirmDisabled={!chosen.length}
      footerLeading={
        <label className="mr-auto flex items-center gap-2 text-caption text-muted-foreground cursor-default">
          <Checkbox
            aria-label={t('Select all')}
            checked={all}
            indeterminate={!all && chosen.length > 0}
            onCheckedChange={() => setSelected(new Set(all ? [] : request.repos))}
          />
          {t('Select all')}
        </label>
      }
      onCancel={() => close(null)}
      onConfirm={() => close(chosen)}
    >
      <p className="muted text-muted-foreground small text-caption m-[0_0_8px]">
        {t("This folder contains several repositories. Untick any you don't want in the project.")}
      </p>
      <div className="flex flex-col gap-0.5 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain">
        {request.repos.map((repo) => (
          <label
            key={repo}
            className="[&:hover]:bg-hover flex items-center gap-2.5 min-h-[32px] p-[2px_6px] rounded-(--radius-s) cursor-default"
            title={repo}
          >
            <Checkbox aria-label={name(repo)} checked={selected.has(repo)} onCheckedChange={() => toggle(repo)} />
            <span className="font-semibold overflow-hidden text-ellipsis whitespace-nowrap">{name(repo)}</span>
          </label>
        ))}
      </div>
    </Dialog>
  )
}

/**
 * Search GitHub through the host's account and clone the chosen repository into the folder being browsed. A pasted
 * Git URL stays available. The host does the clone with its own Git credentials; a failed clone keeps its folder.
 */
function CloneFromGitHub({
  host,
  parent,
  onCloned,
  onBack,
}: {
  host: string
  parent: string
  onCloned: (path: string) => void
  onBack: () => void
}) {
  useLanguage()
  const [query, setQuery] = useState('')
  const [url, setUrl] = useState('')
  const [results, setResults] = useState<ForgeRepositorySummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [cloning, setCloning] = useState<string | null>(null)
  const cloneRun = useClone(host)
  const [error, setError] = useState('')
  const request = useRef(0)
  useEffect(() => {
    // Debounced; a slow older search never replaces a newer one.
    const mine = ++request.current
    setSearching(true)
    const timer = setTimeout(
      () => {
        invokerFor(host)('forge.searchRepositories', query.trim()).then(
          (found) => {
            if (mine !== request.current) return
            setResults(found)
            setError('')
            setSearching(false)
          },
          (reason) => {
            if (mine !== request.current) return
            setResults([])
            setError(errorText(reason))
            setSearching(false)
          },
        )
      },
      query ? 350 : 0,
    )
    return () => clearTimeout(timer)
  }, [host, query])
  const clone = async (cloneUrl: string, folder: string) => {
    setCloning(cloneUrl)
    setError('')
    try {
      onCloned(await cloneRun.run(parent, folder, cloneUrl))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setCloning(null)
    }
  }
  const folderOf = (value: string) =>
    value
      .replace(/\/+$/, '')
      .replace(/\.git$/, '')
      .split(/[/:]/)
      .pop() ?? ''
  return (
    <div className="flex flex-col gap-2">
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        <ChevronLeft size={14} /> {t('Back to folders')}
      </Button>
      <p className="muted text-muted-foreground small text-caption m-0 truncate" title={parent}>
        {t('Clone into {0}', { '0': parent })}
      </p>
      <Input
        autoFocus
        value={query}
        placeholder={t('Search GitHub repositories')}
        aria-label={t('Search GitHub repositories')}
        onChange={(event) => setQuery(event.target.value)}
      />
      {error && (
        <p role="alert" className="m-0 text-caption text-bad">
          {error}
        </p>
      )}
      <div
        className="flex flex-col gap-0.5 max-h-[min(40vh,320px)] overflow-y-auto overscroll-contain"
        aria-busy={searching}
      >
        {results?.map((repository) => (
          <button
            key={repository.fullName}
            type="button"
            disabled={!!cloning}
            className="[&:hover]:bg-hover flex w-full flex-col items-start gap-0.5 p-[4px_6px] rounded-(--radius-s) cursor-default border-0 bg-transparent text-left text-body disabled:opacity-60"
            onClick={() => void clone(repository.cloneUrl, folderOf(repository.fullName))}
          >
            <span className="flex items-center gap-1.5 font-semibold">
              {repository.fullName}
              {repository.private && <Lock size={12} aria-label={t('Private repository')} />}
            </span>
            {repository.description && (
              <span className="text-caption text-muted-foreground">{repository.description}</span>
            )}
          </button>
        ))}
        {results && !results.length && !searching && !error && (
          <p className="muted text-muted-foreground small text-caption m-0 p-[2px_6px]">{t('No repositories found')}</p>
        )}
      </div>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (url.trim()) void clone(url.trim(), folderOf(url.trim()))
        }}
      >
        <Input
          value={url}
          placeholder={t('Or paste a Git URL')}
          aria-label={t('Or paste a Git URL')}
          autoCapitalize="none"
          spellCheck={false}
          onChange={(event) => setUrl(event.target.value)}
        />
        <Button type="submit" variant="secondary" size="sm" disabled={!!cloning || !folderOf(url.trim())}>
          {cloning ? cloneProgressText(cloneRun.progress, t) : t('Clone')}
        </Button>
        {cloning && cloneRun.canCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={cloneRun.cancel}>
            {t('Cancel clone')}
          </Button>
        )}
      </form>
    </div>
  )
}

type Listing = { path: string; parent: string | null; folders: { name: string; path: string }[] }

/** Browses folders on the host this window is connected to, since a native picker would open on that machine instead. */
function HostFolderDialog() {
  useLanguage()
  const [request, setRequest] = useState<FolderPick | null>(null)
  const [roots, setRoots] = useState<string[]>([])
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState('')
  const [cloning, setCloning] = useState(false)
  const browse = (path: string, host = request?.host) =>
    invokerFor(host ?? ownHostId())('folders.list', path)
      .then((next) => {
        setListing(next)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
  useEffect(
    () =>
      onFolderPick((next) => {
        setRequest(next)
        setListing(null)
        setCloning(false)
        setError('')
        // The folders are on the host the project is added to, which may not be the one on screen.
        invokerFor(next.host)('folders.roots')
          .then((found) => {
            setRoots(found)
            if (found.length === 1) void browse(found[0]!, next.host)
          })
          .catch((e) => setError(errorText(e)))
      }),
    [],
  )
  if (!request) return null
  const close = (dir: string | null) => {
    const { resolve } = request
    setRequest(null)
    resolve(dir)
  }
  const rows = listing ? listing.folders : roots.map((path) => ({ name: path, path }))
  const rowClass =
    '[&:hover]:bg-hover flex w-full items-center justify-start gap-2.5 min-h-[32px] p-[2px_6px] rounded-(--radius-s) cursor-default border-0 bg-transparent text-left text-body'
  return (
    <Dialog
      title={t('Choose a folder on the host')}
      confirmLabel={t('Add this folder')}
      confirmDisabled={!listing || cloning}
      footerLeading={
        listing && !cloning ? (
          <Button variant="ghost" size="sm" className="mr-auto" onClick={() => setCloning(true)}>
            {t('Clone from GitHub')}
          </Button>
        ) : undefined
      }
      onCancel={() => close(null)}
      onConfirm={() => listing && close(listing.path)}
    >
      {cloning && listing ? (
        <CloneFromGitHub
          host={request.host}
          parent={listing.path}
          onCloned={(path) => close(path)}
          onBack={() => setCloning(false)}
        />
      ) : null}
      <p
        className="muted text-muted-foreground small text-caption m-[0_0_8px] truncate"
        title={listing?.path}
        hidden={cloning}
      >
        {listing?.path ?? t('Choose where to start browsing')}
      </p>
      {error && <p className="m-[0_0_8px] text-caption text-bad">{error}</p>}
      <div
        className={`flex flex-col gap-0.5 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain${cloning ? ' hidden' : ''}`}
      >
        {listing && (
          <button
            type="button"
            className={rowClass}
            onClick={() => (listing.parent ? void browse(listing.parent) : setListing(null))}
          >
            <ChevronLeft size={15} className="flex-none text-muted-foreground" />
            <span>{t('Parent folder')}</span>
          </button>
        )}
        {rows.map((folder) => (
          <button key={folder.path} type="button" className={rowClass} onClick={() => void browse(folder.path)}>
            <Folder size={15} className="flex-none text-muted-foreground" />
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{folder.name}</span>
          </button>
        ))}
        {listing && !rows.length && (
          <p className="muted text-muted-foreground small text-caption m-0 p-[2px_6px]">{t('No folders here')}</p>
        )}
      </div>
    </Dialog>
  )
}
