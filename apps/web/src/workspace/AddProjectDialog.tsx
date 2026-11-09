import { RowButton } from '@/components/row-button'
import { t, useLanguage } from '../i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../Menu'
import { Check, ChevronLeft, ChevronRight, Folder, FolderGit2, FolderPlus, HardDrive, Lock, X } from 'lucide-react'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
import {
  cloneFolderName,
  cloneProgressText,
  folderCrumbs,
  folderName as name,
  type HostFolderListing,
} from '@ramu/shared/workspace/hostFolders'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/desktop-input'
import { invokerFor } from '../ipc'
import { ownHostId } from '../hosts'
import { errorText } from './TaskPane'
import { useClone } from './useClone'
import { onFolderPick, onRepoChoice, type FolderPick, type RepoChoice } from './addProject'
import { BrandIcon } from '@/components/brand-icon'

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
  search = '',
  onCloned,
  onBack,
}: {
  host: string
  parent: string
  /** The repository asked for, searched for at once. */
  search?: string
  onCloned: (path: string) => void
  onBack: () => void
}) {
  useLanguage()
  const [query, setQuery] = useState(search)
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
  const folderOf = cloneFolderName
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
          <RowButton
            stacked
            key={repository.fullName}
            disabled={!!cloning}
            className="px-1.5 py-1"
            onClick={() => void clone(repository.cloneUrl, folderOf(repository.fullName))}
          >
            <span className="flex items-center gap-1.5 font-semibold">
              {repository.fullName}
              {repository.private && <Lock size={12} aria-label={t('Private repository')} />}
            </span>
            {repository.description && (
              <span className="text-caption text-muted-foreground">{repository.description}</span>
            )}
          </RowButton>
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
          {cloning ? cloneProgressText(cloneRun.progress, (text) => t(text)) : t('Clone')}
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

/**
 * Browses folders on the host the project is added to, since a native picker would open on this machine instead: a
 * path to step back along, Git repositories marked, a new folder named in place, or a repository cloned here.
 */
function HostFolderDialog() {
  useLanguage()
  const [request, setRequest] = useState<FolderPick | null>(null)
  const [roots, setRoots] = useState<string[]>([])
  const [listing, setListing] = useState<HostFolderListing | null>(null)
  const [error, setError] = useState('')
  const [cloning, setCloning] = useState(false)
  // The new folder's name while its row is open; null while it is closed.
  const [naming, setNaming] = useState<string | null>(null)
  const browse = (path: string, host = request?.host) =>
    invokerFor(host ?? ownHostId())('folders.list', path)
      .then((next) => {
        setListing(next)
        setNaming(null)
        setError('')
      })
      .catch((e) => setError(errorText(e)))
  useEffect(
    () =>
      onFolderPick((next) => {
        setRequest(next)
        setListing(null)
        // A repository asked for by name opens on its clone search once a folder is listed.
        setCloning(!!next.clone)
        setNaming(null)
        setError('')
        // The folders are on the host the project is added to, which may not be the one on screen.
        invokerFor(next.host)('folders.roots')
          .then((found) => {
            setRoots(found)
            if (found.length === 1) void browse(found[0]!, next.host)
          })
          .catch((e) => setError(errorText(e)))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design; the values it reads beyond these are current as of that run
    [],
  )
  if (!request) return null
  const close = (dir: string | null) => {
    const { resolve } = request
    setRequest(null)
    resolve(dir)
  }
  const create = () => {
    if (!listing || !naming?.trim()) return
    invokerFor(request.host)('folders.create', listing.path, naming.trim())
      .then((path) => browse(path))
      .catch((e) => setError(errorText(e)))
  }
  const crumbs = listing ? folderCrumbs(listing.path, roots) : []
  return (
    <Dialog
      title={t('Choose a folder on the host')}
      confirmLabel={listing ? t('Add {0}', { '0': name(listing.path) }) : t('Add this folder')}
      confirmDisabled={!listing || cloning}
      footerLeading={
        listing && !cloning ? (
          <div className="mr-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setNaming('')}>
              <FolderPlus size={14} /> {t('New folder')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setCloning(true)}>
              <BrandIcon brand="github" /> {t('Clone from GitHub')}
            </Button>
          </div>
        ) : undefined
      }
      onCancel={() => close(null)}
      onConfirm={() => listing && close(listing.path)}
    >
      {cloning && listing ? (
        <CloneFromGitHub
          host={request.host}
          parent={listing.path}
          search={request.clone}
          onCloned={(path) => close(path)}
          onBack={() => setCloning(false)}
        />
      ) : null}
      <div hidden={cloning && !!listing}>
        {/* Where you are, one click per step back up; Locations returns to the host's starting places. */}
        <nav aria-label={t('Folder path')} className="mb-2 flex min-w-0 flex-wrap items-center gap-0.5 text-caption">
          {roots.length > 1 || !listing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-muted-foreground"
                aria-current={listing ? undefined : 'page'}
                onClick={() => setListing(null)}
              >
                <HardDrive size={12} /> {t('Locations')}
              </Button>
              {listing && <ChevronRight size={12} className="flex-none text-muted-foreground opacity-60" />}
            </>
          ) : null}
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1
            return (
              <span key={crumb.path} className="flex min-w-0 items-center gap-0.5">
                {index > 0 && <ChevronRight size={12} className="flex-none text-muted-foreground opacity-60" />}
                <Button
                  variant="ghost"
                  size="sm"
                  title={crumb.path}
                  aria-current={last ? 'page' : undefined}
                  className={`h-6 max-w-[180px] px-1.5 ${last ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                  onClick={() => !last && void browse(crumb.path)}
                >
                  <span className="truncate">{crumb.name}</span>
                </Button>
              </span>
            )
          })}
        </nav>
        {error && <p className="m-[0_0_8px] text-caption text-bad">{error}</p>}
        <div className="flex flex-col gap-0.5 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain">
          {naming !== null && listing && (
            <form
              className="flex items-center gap-1.5 px-1.5"
              onSubmit={(event) => {
                event.preventDefault()
                create()
              }}
            >
              <FolderPlus size={15} className="flex-none text-muted-foreground" />
              <Input
                autoFocus
                value={naming}
                placeholder={t('Folder name')}
                aria-label={t('Folder name')}
                spellCheck={false}
                onChange={(event) => setNaming(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setNaming(null)
                  }
                }}
              />
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={!naming.trim()}
                aria-label={t('Create folder')}
              >
                <Check size={14} />
              </Button>
              <Button type="button" variant="ghost" size="sm" aria-label={t('Cancel')} onClick={() => setNaming(null)}>
                <X size={14} />
              </Button>
            </form>
          )}
          {listing
            ? listing.folders.map((folder) => (
                <RowButton
                  key={folder.path}
                  size="sm"
                  title={folder.path}
                  aria-label={folder.repo ? `${folder.name}, ${t('Git repository')}` : folder.name}
                  onClick={() => void browse(folder.path)}
                >
                  {folder.repo ? (
                    <FolderGit2 size={15} className="flex-none text-brand" />
                  ) : (
                    <Folder size={15} className="flex-none text-muted-foreground" />
                  )}
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{folder.name}</span>
                </RowButton>
              ))
            : roots.map((root) => (
                <RowButton key={root} size="sm" title={root} onClick={() => void browse(root)}>
                  <HardDrive size={15} className="flex-none text-muted-foreground" />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name(root)}</span>
                  <span className="ml-auto truncate text-caption text-muted-foreground">{root}</span>
                </RowButton>
              ))}
          {listing && !listing.folders.length && (
            <p className="muted text-muted-foreground small text-caption m-0 p-[2px_6px]">{t('No folders here')}</p>
          )}
        </div>
      </div>
    </Dialog>
  )
}
