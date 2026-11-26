import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useQueries } from '@tanstack/react-query'
import { ArrowUp, Copy, FolderOpen } from 'lucide-react'
import { TreeLoading } from './TreeLoading'
import { Button } from '@/components/desktop-button'
import { HOST_FILES_REPO } from '@ramu/shared/workspace/fileLinks'
import type { DirEntry } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { copyText } from '../../ipc'
import { useContextMenu } from '../../Menu'
import { notifyError } from '../../chat/Notifications'
import { errorText } from '../../workspace/TaskPane'
import { useHost } from '../../workspace/HostProvider'
import { useWorkspace } from '../../workspace/workspace'
import { ipcQueryKeyOn } from '../../dataQueries'
import { queryInvokerFor } from '../../git/hostQuery'
import { ICON_BUTTON_CLASS, REPO_TREE_CLASS, TREE_CHILDREN_CLASS, TREE_ROOT_CLASS } from './constants'
import { isWithin, parentOf } from './paths'
import { TreeCaret } from './TreeCaret'
import { TreeRow, type TreeRowHandlers } from './TreeRow'

const absolute = (path: string) => `/${path}`
const ignore = () => {}

/**
 * The folder around a file the thread opened outside its folders, such as a report an agent wrote to a temp folder.
 * It starts at that file's folder and can step up toward `/`; it only browses, since changes to files outside the
 * thread's folders go through the editor.
 */
export function HostFolderTree({ taskId, filePath }: { taskId: string; filePath: string }) {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const [root, setRoot] = useState(() => parentOf(filePath))
  const [open, setOpen] = useState<Set<string>>(() => new Set([parentOf(filePath)]))
  const [target, setTarget] = useState<DirEntry | null>(null)
  const selectedRow = useRef<HTMLButtonElement>(null)

  // Another outside file moves the tree to its folder, unless the folder in view already holds it.
  useEffect(() => {
    const folder = parentOf(filePath)
    setRoot((current) => (current === '' || isWithin(folder, current) ? current : folder))
    setOpen((current) => {
      const next = new Set(current)
      for (let dir = folder; ; dir = parentOf(dir)) {
        next.add(dir)
        if (!dir) break
      }
      return next
    })
  }, [filePath])
  const directories = [...open].filter((dir) => root === '' || isWithin(dir, root))
  const listings = useQueries({
    queries: directories.map((dir) => ({
      queryKey: ipcQueryKeyOn(host.id, 'files.browse', taskId, HOST_FILES_REPO, dir),
      queryFn: () => queryInvokerFor(host.id)('files.browse', taskId, HOST_FILES_REPO, dir),
      retry: false,
    })),
  })
  const children: Record<string, { entries: DirEntry[]; truncated: boolean } | Error> = {}
  directories.forEach((dir, index) => {
    const listing = listings[index]
    if (listing?.data) children[dir] = listing.data
    else if (listing?.error) children[dir] = listing.error
  })
  // Scroll the opened file into view once its row has rendered, then leave scrolling to the person.
  const revealed = useRef<string | null>(null)
  useEffect(() => {
    if (revealed.current === filePath || !selectedRow.current) return
    selectedRow.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    revealed.current = filePath
  })
  useEffect(() => {
    const refresh = () => listings.forEach((listing) => void listing.refetch())
    window.addEventListener('ramu:refresh-explorer', refresh)
    return () => window.removeEventListener('ramu:refresh-explorer', refresh)
  })

  const toggle = (dir: string) =>
    setOpen((current) => {
      const next = new Set(current)
      if (next.has(dir)) next.delete(dir)
      else next.add(dir)
      return next
    })
  const copy = (path: string) =>
    void copyText(absolute(path)).catch((reason) => notifyError(errorText(reason), 'Explorer'))
  const context = useContextMenu('Explorer actions', [
    {
      key: 'reveal',
      disabled: !host.isLocal || !target,
      label: (
        <>
          <FolderOpen size={14} />
          {t('Reveal in Finder')}
        </>
      ),
      onSelect: () => {
        if (target)
          void host
            .invoke('files.reveal', taskId, HOST_FILES_REPO, target.path)
            .catch((reason: unknown) => notifyError(errorText(reason), 'Explorer'))
      },
    },
    {
      key: 'copy-path',
      label: (
        <>
          <Copy size={14} />
          {t('Copy path')}
        </>
      ),
      onSelect: () => target && copy(target.path),
    },
  ])
  const handlers: TreeRowHandlers = {
    onContextMenu: (event, entry) => {
      setTarget(entry)
      context.onContextMenu(event)
    },
    onContextKey: (event, entry) => {
      setTarget(entry)
      context.onKeyDown(event)
    },
    onDragOver: ignore,
    onDragLeave: ignore,
    onDrop: ignore,
    onDragEnd: ignore,
    onDragStart: (event) => event.preventDefault(),
    onOpenPinned: (entry) => {
      if (entry.kind === 'file')
        ws.openView(taskId, { kind: 'file', repoId: HOST_FILES_REPO, path: entry.path, preview: false })
    },
    onClick: (_event, entry) => {
      if (entry.kind === 'dir') toggle(entry.path)
      else ws.openView(taskId, { kind: 'file', repoId: HOST_FILES_REPO, path: entry.path, preview: true })
    },
  }

  const render = (dir: string, depth: number) => {
    const listing = children[dir]
    if (listing === undefined) return <TreeLoading depth={depth} />
    if (listing instanceof Error)
      return (
        <p className="muted text-muted-foreground text-caption py-1" style={{ paddingLeft: 8 + depth * 12 }}>
          {errorText(listing)}
        </p>
      )
    return (
      <>
        {listing.entries.map((entry) => {
          const isFile = entry.kind !== 'dir'
          return (
            <div key={entry.path}>
              <TreeRow
                entry={entry}
                depth={depth}
                repoId={HOST_FILES_REPO}
                isOpen={open.has(entry.path)}
                isSelected={isFile && entry.path === filePath}
                isPicked={false}
                isDropTarget={false}
                rowRef={isFile && entry.path === filePath ? selectedRow : undefined}
                handlers={handlers}
              />
              {entry.kind === 'dir' && open.has(entry.path) && (
                <div
                  className={TREE_CHILDREN_CLASS}
                  style={{ '--tree-guide-left': `${14 + depth * 12}px` } as CSSProperties}
                >
                  {render(entry.path, depth + 1)}
                </div>
              )}
            </div>
          )
        })}
        {listing.truncated && (
          <p className="muted text-muted-foreground text-caption py-1" style={{ paddingLeft: 8 + depth * 12 }}>
            {t('Showing the first {0} items.', { '0': listing.entries.length.toLocaleString() })}
          </p>
        )}
      </>
    )
  }

  return (
    <div className={REPO_TREE_CLASS}>
      {context.menu}
      <div className="flex items-center gap-0.5">
        <Button
          variant="tree"
          className={`${TREE_ROOT_CLASS} min-w-0 flex-1`}
          onClick={() => toggle(root)}
          onContextMenu={(event) => {
            setTarget({ name: absolute(root), path: root, kind: 'dir' })
            context.onContextMenu(event)
          }}
          title={absolute(root)}
        >
          <TreeCaret open={open.has(root)} />
          <span className="strong font-semibold">{t('Outside the project')}</span>
          <span className="muted text-muted-foreground small text-caption min-w-0 overflow-hidden text-ellipsis">
            {absolute(root)}
          </span>
        </Button>
        {root !== '' && (
          <Button
            variant="ghost"
            className={ICON_BUTTON_CLASS}
            aria-label={t('Parent folder')}
            title={t('Parent folder')}
            onClick={() => {
              const parent = parentOf(root)
              setRoot(parent)
              setOpen((current) => new Set([...current, parent]))
            }}
          >
            <ArrowUp size={14} />
          </Button>
        )}
      </div>
      {open.has(root) && (
        <div className={TREE_CHILDREN_CLASS} style={{ '--tree-guide-left': '14px' } as CSSProperties}>
          {render(root, 1)}
        </div>
      )}
    </div>
  )
}
