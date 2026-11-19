import { RowButton } from '@/components/row-button'
import { t, useLanguage } from '../i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { useEffect, useRef, useState } from 'react'
import { Dialog } from '../Menu'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Folder,
  FolderGit2,
  FolderPlus,
  HardDrive,
  Loader2,
  Lock,
  X,
} from 'lucide-react'
import type { ForgeRepositorySummary } from '@ramu/shared/types'
import {
  cloneFolderName,
  cloneProgressText,
  cloneStartFolder,
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

/** The repository's clone address as the host's GitHub account reports it, or its plain GitHub HTTPS address. */
async function cloneUrlOf(host: string, repository: string) {
  const found = await invokerFor(host)('forge.searchRepositories', repository).catch(() => [])
  const wanted = repository.toLowerCase()
  return (
    found.find((entry) => entry.fullName.toLowerCase() === wanted)?.cloneUrl ?? `https://github.com/${repository}.git`
  )
}

/**
 * Browses folders on the host the project is added to, since a native picker would open on this machine instead: a
 * path to step back along, Git repositories marked, a new folder named in place, or a repository cloned here. Choosing
 * where a new project goes uses the same browser, opened where it goes now, without the clone. A repository asked for
 * by name (a pull request's) opens where the host's projects sit and clones straight into the folder chosen.
 */
function HostFolderDialog() {
  useLanguage()
  const [request, setRequest] = useState<FolderPick | null>(null)
  const [roots, setRoots] = useState<string[] | null>(null)
  const [listing, setListing] = useState<HostFolderListing | null>(null)
  const [error, setError] = useState('')
  const [searching, setSearching] = useState(false)
  // The folder being opened, shown on its row until the host answers.
  const [opening, setOpening] = useState<string | null>(null)
  // The new folder's name while its row is open; null while it is closed.
  const [naming, setNaming] = useState<string | null>(null)
  const cloneRun = useClone(request?.host ?? ownHostId())
  const browsing = useRef(0)
  const browse = (path: string, host = request?.host) => {
    // Only the latest folder clicked is shown; a slow earlier answer never replaces it.
    const mine = ++browsing.current
    setOpening(path)
    setError('')
    return invokerFor(host ?? ownHostId())('folders.list', path)
      .then((next) => {
        if (mine !== browsing.current) return
        setListing(next)
        setNaming(null)
      })
      .catch((e) => mine === browsing.current && setError(errorText(e)))
      .finally(() => mine === browsing.current && setOpening(null))
  }
  useEffect(
    () =>
      onFolderPick((next) => {
        browsing.current++
        setRequest(next)
        setRoots(null)
        setListing(null)
        setOpening(null)
        setSearching(false)
        setNaming(null)
        setError('')
        const start = next.purpose === 'parent' ? next.start : undefined
        // The folders are on the host the project is added to, which may not be the one on screen.
        invokerFor(next.host)('folders.roots')
          .then((found) => {
            setRoots(found)
            // A folder that is gone or outside the roots falls back to the host's starting places.
            const first =
              start ??
              (next.purpose !== 'parent' && next.clone ? cloneStartFolder(found) : undefined) ??
              (found.length === 1 ? found[0] : undefined)
            if (first) void browse(first, next.host)
          })
          .catch((e) => setError(errorText(e)))
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on [mount only] by design; the values it reads beyond these are current as of that run
    [],
  )
  if (!request) return null
  const close = (dir: string | null) => {
    const { resolve } = request
    browsing.current++
    setRequest(null)
    resolve(dir)
  }
  const create = () => {
    if (!listing || !naming?.trim()) return
    invokerFor(request.host)('folders.create', listing.path, naming.trim())
      .then((path) => browse(path))
      .catch((e) => setError(errorText(e)))
  }
  const crumbs = listing ? folderCrumbs(listing.path, roots ?? []) : []
  const parent = request.purpose === 'parent'
  const repository = request.purpose !== 'parent' ? request.clone : undefined
  const cloneName = repository ? cloneFolderName(repository) : ''
  // The repository may already be here; adding that checkout beats cloning it again.
  const existing = repository ? listing?.folders.find((folder) => folder.name === cloneName && folder.repo) : undefined
  const busy = cloneRun.running
  const cloneHere = async () => {
    if (!listing || !repository) return
    setError('')
    try {
      close(await cloneRun.run(listing.path, cloneName, await cloneUrlOf(request.host, repository)))
    } catch (reason) {
      setError(errorText(reason))
    }
  }
  const confirmLabel = parent
    ? t('Put it here')
    : repository
      ? existing
        ? t('Add {0}', { '0': existing.name })
        : busy
          ? cloneProgressText(cloneRun.progress, (text) => t(text))
          : t('Clone here')
      : listing
        ? t('Add {0}', { '0': name(listing.path) })
        : t('Add this folder')
  const rowStatus = (path: string) =>
    opening === path ? <Loader2 size={13} className="ml-auto flex-none animate-spin text-muted-foreground" /> : null
  return (
    <Dialog
      title={
        parent
          ? t('Choose where to put it')
          : repository
            ? t('Clone {0}', { '0': repository })
            : t('Choose a folder on the host')
      }
      confirmLabel={confirmLabel}
      confirmDisabled={!listing || searching || busy || !!opening}
      footerLeading={
        listing && !searching && !busy ? (
          <div className="mr-auto flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => setNaming('')}>
              <FolderPlus size={14} /> {t('New folder')}
            </Button>
            {!parent && !repository && (
              <Button variant="ghost" size="sm" onClick={() => setSearching(true)}>
                <BrandIcon brand="github" /> {t('Clone from GitHub')}
              </Button>
            )}
          </div>
        ) : undefined
      }
      onCancel={() => {
        // Cancel stops a running clone first; the host removes what it had filled.
        if (busy) cloneRun.cancel()
        else close(null)
      }}
      onConfirm={() => {
        if (!listing) return
        if (repository && !existing) void cloneHere()
        else close(existing?.path ?? listing.path)
      }}
    >
      {searching && listing ? (
        <CloneFromGitHub
          host={request.host}
          parent={listing.path}
          onCloned={(path) => close(path)}
          onBack={() => setSearching(false)}
        />
      ) : null}
      <div hidden={searching && !!listing}>
        {repository && (
          <div className="mb-2.5 flex items-center gap-2.5 rounded-(--radius-m) border border-(--line) bg-fill px-2.5 py-2">
            <BrandIcon brand="github" size={16} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-control font-semibold text-foreground">{repository}</span>
              <span className="truncate text-caption text-muted-foreground" title={listing?.path}>
                {existing
                  ? t('Already cloned here. Add it as a project.')
                  : listing
                    ? t('Clones into {0}', {
                        '0': `${listing.path}${listing.path.endsWith('/') ? '' : '/'}${cloneName}`,
                      })
                    : t('Choose the folder to clone it into.')}
              </span>
            </div>
          </div>
        )}
        {/* Where you are, one click per step back up; Locations returns to the host's starting places. */}
        <nav aria-label={t('Folder path')} className="mb-2 flex min-w-0 flex-wrap items-center gap-0.5 text-caption">
          {(roots?.length ?? 0) > 1 || !listing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-muted-foreground"
                aria-current={listing ? undefined : 'page'}
                disabled={busy}
                onClick={() => {
                  browsing.current++
                  setOpening(null)
                  setListing(null)
                }}
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
                  disabled={busy}
                  className={`h-6 max-w-[180px] px-1.5 ${last ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}
                  onClick={() => !last && void browse(crumb.path)}
                >
                  <span className="truncate">{crumb.name}</span>
                </Button>
              </span>
            )
          })}
        </nav>
        {error && (
          <p role="alert" className="m-[0_0_8px] text-caption text-bad">
            {error}
          </p>
        )}
        <div
          className="flex flex-col gap-0.5 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain"
          aria-busy={!!opening || !roots}
        >
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
          {!roots && !error && (
            <p className="m-0 flex items-center gap-2 p-[2px_6px] text-caption text-muted-foreground">
              <Loader2 size={13} className="animate-spin" /> {t('Loading folders…')}
            </p>
          )}
          {listing
            ? listing.folders.map((folder) => (
                <RowButton
                  key={folder.path}
                  size="sm"
                  title={folder.path}
                  disabled={busy}
                  aria-label={folder.repo ? `${folder.name}, ${t('Git repository')}` : folder.name}
                  onClick={() => void browse(folder.path)}
                >
                  {folder.repo ? (
                    <FolderGit2 size={15} className="flex-none text-brand" />
                  ) : (
                    <Folder size={15} className="flex-none text-muted-foreground" />
                  )}
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{folder.name}</span>
                  {rowStatus(folder.path)}
                </RowButton>
              ))
            : roots?.map((root) => (
                <RowButton key={root} size="sm" title={root} disabled={busy} onClick={() => void browse(root)}>
                  <HardDrive size={15} className="flex-none text-muted-foreground" />
                  <span className="overflow-hidden text-ellipsis whitespace-nowrap">{name(root)}</span>
                  {rowStatus(root) ?? (
                    <span className="ml-auto truncate text-caption text-muted-foreground">{root}</span>
                  )}
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
