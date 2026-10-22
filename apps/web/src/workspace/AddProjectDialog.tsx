import { t, useLanguage } from '../i18n'
import { Checkbox } from '@/components/ui/checkbox'
import { useEffect, useState } from 'react'
import { Dialog } from '../Menu'
import { Folder, ChevronLeft } from 'lucide-react'
import { invokerFor } from '../ipc'
import { ownHostId } from '../hosts'
import { errorText } from './TaskPane'
import { CloneFromGitHub } from './CloneFromGitHub'
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

type Listing = { path: string; parent: string | null; folders: { name: string; path: string }[] }

/** Browses folders on the host this window is connected to, since a native picker would open on that machine instead. */
function HostFolderDialog() {
  useLanguage()
  const [request, setRequest] = useState<FolderPick | null>(null)
  const [roots, setRoots] = useState<string[]>([])
  const [listing, setListing] = useState<Listing | null>(null)
  const [error, setError] = useState('')
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
      confirmDisabled={!listing}
      onCancel={() => close(null)}
      onConfirm={() => listing && close(listing.path)}
    >
      <p className="muted text-muted-foreground small text-caption m-[0_0_8px] truncate" title={listing?.path}>
        {listing?.path ?? t('Choose where to start browsing')}
      </p>
      {error && <p className="m-[0_0_8px] text-caption text-bad">{error}</p>}
      <div className="flex flex-col gap-0.5 max-h-[min(50vh,420px)] overflow-y-auto overscroll-contain">
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
      {listing && <CloneFromGitHub host={request.host} parent={listing.path} onCloned={(path) => close(path)} />}
    </Dialog>
  )
}
