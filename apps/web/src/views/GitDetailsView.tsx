import { useEffect, useMemo, useState } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import type { RepositoryBinding, ViewDescriptor } from '@ramu/shared/types'
import { parseGitPatch, type GitPatch } from '@ramu/shared/gitPatch'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Button } from '@/components/desktop-button'
import { Checkbox } from '@/components/desktop-checkbox'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { cn } from 'cn'
import { FileIcon } from '../editor/FileIcon'
import { FileDiff, FilePath, NearFileDiff, STATUS_LABEL } from '../git/PullRequestFiles'
import { useViewedFiles } from '../git/viewedFiles'
import { formatLocale, t, useLanguage } from '../i18n'
import { useHost } from '../workspace/HostProvider'
import { useHostRuntime } from '../workspace/workspace'
import { errorText } from '../workspace/TaskPane'

/** Past this many files or changed lines a comparison opens with its files closed, so it shows at once. */
const OPEN_FILES = 25
const OPEN_LINES = 3000
const never = async () => false

/**
 * One commit in full, or what a branch has that its upstream does not: the files that changed, each with its diff as
 * the pull request view draws it, under the commit's message. Read-only: nothing here can be commented on or staged.
 */
export function GitDetailsView({
  taskId,
  view,
  binding,
}: {
  taskId: string
  view: Extract<ViewDescriptor, { kind: 'git' }>
  binding: RepositoryBinding
}) {
  useLanguage()
  const { invoke, id: hostId } = useHost()
  const viewed = useViewedFiles(hostId, view.oid ? `commit:${view.oid}` : `compare:${binding.repoId}`)
  const { on } = useHostRuntime()
  const [patch, setPatch] = useState<GitPatch | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Which files the person opened or closed by hand; the rest follow the default for the size of the change.
  const [toggled, setToggled] = useState<Map<string, boolean>>(new Map())
  useEffect(() => {
    let disposed = false
    let request = 0
    setPatch(null)
    setError(null)
    setToggled(new Map())
    const load = async () => {
      const current = ++request
      try {
        const text = view.oid
          ? await invoke('git.commitDetails', taskId, binding.repoId, view.oid)
          : await invoke('git.compareUpstream', taskId, binding.repoId)
        if (disposed || current !== request) return
        setPatch(parseGitPatch(text))
        setError(null)
      } catch (e) {
        if (!disposed && current === request) setError(errorText(e))
      }
    }
    void load()
    let timer: ReturnType<typeof setTimeout> | undefined
    // A comparison follows the checkout; a commit never changes.
    const off = on('fs:changed', ({ cwd }) => {
      if (view.oid || cwd !== binding.cwd) return
      clearTimeout(timer)
      timer = setTimeout(() => void load(), 150)
    })
    return () => {
      disposed = true
      clearTimeout(timer)
      off()
    }
  }, [taskId, binding.repoId, binding.cwd, view.oid, invoke, on])

  const files = useMemo(() => patch?.files ?? [], [patch])
  const totals = useMemo(
    () =>
      files.reduce((sum, file) => ({ added: sum.added + file.additions, removed: sum.removed + file.deletions }), {
        added: 0,
        removed: 0,
      }),
    [files],
  )
  const openByDefault = files.length <= OPEN_FILES && totals.added + totals.removed <= OPEN_LINES
  // A file ticked as viewed folds away, as it does on the hosting services, unless it was opened again by hand.
  const isOpen = (file: (typeof files)[number]) => toggled.get(file.path) ?? (openByDefault && !viewed.isViewed(file))
  const viewedCount = files.filter((file) => viewed.isViewed(file)).length
  const setAll = (open: boolean) => setToggled(new Map(files.map((file) => [file.path, open])))
  const anyOpen = files.some((file) => isOpen(file))
  const count = (value: number) => value.toLocaleString(formatLocale())
  const commit = patch?.commit

  return (
    <div className="file-view flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="view-header flex h-8 min-w-0 flex-none items-center gap-2.5 p-[0_12px] text-control text-soft">
        <span className="font-semibold">{binding.repoName}</span>
        <span className="min-w-0 flex-1 truncate" title={view.title}>
          {view.title}
        </span>
        {view.url && (
          <Button variant="ghost" size="sm" onClick={() => window.open(view.url, '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={13} />
            {t('Open on the hosting service')}
          </Button>
        )}
      </div>
      {error && <div className="flex-none p-[7px_12px] text-control text-bad">{error}</div>}
      {!patch && !error ? (
        <ContentSkeleton variant="editor" rows={12} className="flex-1" />
      ) : (
        patch && (
          <OverlayScrollArea className="min-h-0 flex-1">
            <div className="mx-auto flex max-w-[1100px] flex-col gap-3 px-4 pt-2 pb-8">
              {commit && (
                <header className="flex flex-col gap-1.5">
                  <h2 className="m-0 text-[length:var(--font-title,18px)] font-semibold leading-snug [overflow-wrap:anywhere] select-text">
                    {commit.subject}
                  </h2>
                  {commit.body && (
                    <p className="m-0 text-control whitespace-pre-wrap text-soft select-text">{commit.body}</p>
                  )}
                  <p className="m-0 text-caption text-muted-foreground">
                    {[
                      commit.author,
                      Number.isNaN(Date.parse(commit.date))
                        ? commit.date
                        : new Date(commit.date).toLocaleString(formatLocale()),
                      commit.oid.slice(0, 7),
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </header>
              )}
              {files.length ? (
                <div className="flex items-center gap-2 text-caption text-muted-foreground">
                  <span>
                    {files.length === 1 ? t('1 file changed') : t('{count} files changed', { count: files.length })}
                  </span>
                  <span className="tabular-nums">
                    <span className="text-ok">+{count(totals.added)}</span>{' '}
                    <span className="text-bad">−{count(totals.removed)}</span>
                  </span>
                  {viewedCount > 0 && <span>{t('{0} of {1} viewed', { 0: viewedCount, 1: files.length })}</span>}
                  <span className="flex-1" />
                  <Button variant="ghost" size="sm" onClick={() => setAll(!anyOpen)}>
                    {anyOpen ? t('Collapse all') : t('Expand all')}
                  </Button>
                </div>
              ) : (
                <p className="m-0 text-control text-muted-foreground">
                  {view.oid ? t('This commit changes no files.') : t('No differences with upstream.')}
                </p>
              )}
              {files.map((file) => {
                const open = isOpen(file)
                const seen = viewed.isViewed(file)
                const status = STATUS_LABEL[file.status]
                return (
                  // No overflow clipping here: it would stop the file's header from staying pinned while its diff scrolls.
                  <section key={file.path}>
                    <div
                      className={cn(
                        'sticky top-0 z-10 flex items-stretch border border-line bg-card',
                        open ? 'rounded-t-(--radius-m)' : 'rounded-(--radius-m)',
                      )}
                    >
                      <Button
                        variant="ghost"
                        className={cn(
                          'h-auto min-w-0 flex-1 justify-start gap-2 rounded-none border-0 bg-transparent px-3 py-2 text-left font-normal hover:bg-hover',
                          open ? 'rounded-tl-(--radius-m)' : 'rounded-l-(--radius-m)',
                          seen && 'opacity-70',
                        )}
                        aria-expanded={open}
                        onClick={() => setToggled((current) => new Map(current).set(file.path, !open))}
                      >
                        <ChevronRight size={13} className={cn('flex-none transition-transform', open && 'rotate-90')} />
                        <FileIcon path={file.path} size={14} className="flex-none" />
                        <FilePath file={file} />
                        {status && <span className="flex-none text-caption text-muted-foreground">{t(status)}</span>}
                        <span className="flex-none text-caption tabular-nums">
                          <span className="text-ok">+{count(file.additions)}</span>{' '}
                          <span className="text-bad">−{count(file.deletions)}</span>
                        </span>
                      </Button>
                      <label className="flex flex-none cursor-pointer items-center gap-1.5 border-l border-line px-3 text-caption text-muted-foreground hover:text-foreground">
                        <Checkbox
                          checked={seen}
                          onCheckedChange={(checked) => {
                            viewed.setFile(file, checked === true)
                            // Ticking folds the file; the next one is then at the top.
                            setToggled((current) => {
                              const next = new Map(current)
                              next.delete(file.path)
                              return next
                            })
                          }}
                        />
                        {t('Viewed')}
                      </label>
                    </div>
                    {open &&
                      (file.patch ? (
                        <NearFileDiff lines={file.additions + file.deletions}>
                          <FileDiff
                            file={file}
                            threads={[]}
                            pending={[]}
                            canComment={false}
                            wrap={false}
                            highlight=""
                            onAdd={() => {}}
                            onRemove={() => {}}
                            onWrite={never}
                          />
                        </NearFileDiff>
                      ) : (
                        <p className="m-0 rounded-b-(--radius-m) border-x border-b border-line px-3 py-2 text-caption text-muted-foreground">
                          {t('No text changes to show: a binary file, a rename or a mode change.')}
                        </p>
                      ))}
                  </section>
                )
              })}
            </div>
          </OverlayScrollArea>
        )
      )}
    </div>
  )
}
