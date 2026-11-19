import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent } from 'react'
import { ContentSkeleton } from '@/components/content-skeleton'
import { Button } from '@/components/desktop-button'
import type { DirEntry, RepositoryBinding } from '@ramu/shared/types'
import { t, useLanguage } from '../../i18n'
import { useContextMenu } from '../../Menu'
import { notifyError } from '../../chat/Notifications'
import { errorText } from '../../workspace/TaskPane'
import { ramu, copyText, invoke as ownInvoke } from '../../ipc'
import { LOCAL_HOST } from '../../hosts'
import { useComputers } from '../../workspace/computers'
import { FILE_DRAG_TYPE } from '../../composer/ComposerSuggestions'
import { useWorkspace } from '../../workspace/workspace'
import { ActionDialog } from './ActionDialog'
import { REPO_TREE_CLASS, TREE_CHILDREN_CLASS, TREE_ROOT_CLASS } from './constants'
import { explorerMenuEntries } from './menuEntries'
import { baseName, freeName, isValidEntryName, isWithin, joinPath, parentOf } from './paths'
import {
  explorerClipboard,
  sharedForHost,
  type Clip,
  type PlaceSource,
  type TreeAction,
  type TreeItems,
} from './shared'
import { copyBetweenHosts } from './transfer'
import { withTransferToast } from './transferToast'
import { TreeCaret } from './TreeCaret'
import { TreeRow, type TreeRowHandlers } from './TreeRow'
import { useRepoListing } from './useRepoListing'
import { useHost } from '../../workspace/HostProvider'

export function RepoTree({
  taskId,
  binding,
  primary,
  nested,
}: {
  taskId: string
  binding: RepositoryBinding
  primary: boolean
  /** Folders shown as their own tree, left out here. */
  nested: Set<string>
}) {
  useLanguage()
  const ws = useWorkspace()
  const host = useHost()
  const { invoke } = host
  const shared = sharedForHost(host.id)
  const computers = useComputers()
  const [target, setTarget] = useState<DirEntry>({ name: binding.repoName, path: '', kind: 'dir' })
  const [action, setAction] = useState<TreeAction | null>(null)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [showFolderSelection, setShowFolderSelection] = useState(true)
  const anchor = useRef<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => {
    if (action && action.type !== 'delete') {
      nameInput.current?.focus()
      nameInput.current?.select()
    }
  }, [action])
  const selectedRow = useRef<HTMLButtonElement>(null)
  const state = ws.taskUi[taskId]
  const active = state?.views.find((view) => view.id === state.activeViewId)
  const workspaceUi = ws.taskUi[ws.workspaceOf(taskId)]
  const lastFile = workspaceUi?.views.find((view) => view.id === workspaceUi.activeViewId)
  const selected = active?.kind === 'file' || active?.kind === 'diff' ? active : lastFile
  const selectedPath =
    selected && (selected.kind === 'file' || selected.kind === 'diff') && selected.repoId === binding.repoId
      ? selected.path
      : null
  useLayoutEffect(() => {
    // Tab changes replace the previous tree selection as well as the active-file highlight.
    setPicked(selectedPath ? [selectedPath] : [])
    anchor.current = selectedPath
  }, [selectedPath])
  const { open, setOpen, children, load, toggle, reloadAll } = useRepoListing(
    taskId,
    binding,
    selectedPath,
    selectedRow,
    nested,
  )

  // ---- selection, clipboard, drag and drop ----
  const entryAt = (path: string): DirEntry | undefined =>
    (children[parentOf(path)] ?? []).find((entry) => entry.path === path)
  const visible = (dir: string): DirEntry[] =>
    (children[dir] ?? []).flatMap((entry) =>
      entry.kind === 'dir' && open.has(entry.path) ? [entry, ...visible(entry.path)] : [entry],
    )
  const pickedEntries = picked.map(entryAt).filter((entry): entry is DirEntry => !!entry)
  const deletePicked = (clicked?: DirEntry) => {
    const entries =
      clicked && !picked.includes(clicked.path)
        ? [clicked]
        : pickedEntries.length
          ? pickedEntries
          : clicked
            ? [clicked]
            : []
    if (entries.length) begin({ type: 'delete', entries })
  }
  const fail = (reason: unknown) => notifyError(errorText(reason), 'Explorer')
  const hostName = (id: string) =>
    computers?.computers.find((computer) => computer.id === id)?.name ?? (id === LOCAL_HOST ? t('this computer') : id)
  /** Open views of these items with unsaved changes, in the checkout of `owner` (this tree's by default). */
  const viewsWithin = (paths: string[], owner = { taskId, repoId: binding.repoId }) =>
    (ws.taskUi[ws.workspaceOf(owner.taskId)]?.views ?? []).filter(
      (view) =>
        (view.kind === 'file' || (view.kind === 'diff' && !view.oid)) &&
        view.repoId === owner.repoId &&
        paths.some((path) => isWithin(view.path, path)),
    )
  const hasDirty = (paths: string[], owner?: { taskId: string; repoId: string }) =>
    viewsWithin(paths, owner).some((view) => ws.dirty[view.id])
  const absolute = (path: string) => (path ? `${binding.cwd}/${path}` : binding.cwd)
  /** A picked folder already carries what is picked inside it. */
  const outermost = (paths: string[]) =>
    paths.filter((path) => !paths.some((parent) => path !== parent && path.startsWith(`${parent}/`)))
  const here: TreeItems = { hostId: host.id, taskId, repoId: binding.repoId, cwd: binding.cwd, paths: [] }
  const sameCheckout = (items: TreeItems) => items.hostId === host.id && items.cwd === binding.cwd
  const setClip = (paths: string[], cut: boolean) => {
    if (!paths.length) return
    const clip: Clip = { ...here, paths, cut }
    explorerClipboard.clip = clip
    // Copies of this computer's files also go to the system clipboard, so Finder can paste them too.
    const system = host.isLocal && !cut ? outermost(paths).map(absolute) : null
    if (system) {
      clip.systemFiles = system.join('\n')
      void ownInvoke('clipboard.writeFiles', system).catch(() => {})
    } else
      void ownInvoke('clipboard.readFiles')
        .catch(() => [])
        .then((files) => {
          if (explorerClipboard.clip === clip) clip.systemFiles = files.join('\n')
        })
  }
  const [systemFiles, setSystemFiles] = useState<string[]>([])
  const readSystemFiles = () =>
    ownInvoke('clipboard.readFiles').then(
      (files) => {
        setSystemFiles(files)
        return files
      },
      () => [] as string[],
    )
  /** The newest copy wins: this window's, unless files were copied in Finder (or another app) after it. */
  const pasteSource = (files: string[]): PlaceSource | null => {
    const clip = explorerClipboard.clip
    if (clip && (!files.length || clip.systemFiles === undefined || files.join('\n') === clip.systemFiles))
      return { kind: 'tree', ...clip }
    return files.length ? { kind: 'system', paths: files } : null
  }
  const paste = async (dir: string) => {
    const source = pasteSource(await readSystemFiles())
    if (!source) return
    const moved = await placeInto(dir, source)
    if (moved && source.kind === 'tree' && source.cut) explorerClipboard.clip = null
  }
  const placed = async (dir: string, done: string[]) => {
    setOpen((current) => new Set([...current, dir]))
    await reloadAll()
    if (done.length) {
      setPicked(done)
      anchor.current = done[0]!
    }
    window.dispatchEvent(new Event('ramu:git-updated'))
  }
  /** Rearranges items inside this checkout: a copy gets a free name, a cut moves (and keeps its name). */
  const arrange = async (dir: string, paths: string[], cut: boolean) => {
    if (cut && hasDirty(paths)) throw new Error(t('Save or close unsaved files in these items before moving them.'))
    const listing = await invoke('files.list', taskId, binding.repoId, dir).catch(() => [])
    const taken = new Set(listing.map((entry) => entry.name)),
      done: string[] = []
    for (const path of outermost(paths)) {
      if (cut && (path === dir || dir.startsWith(`${path}/`)))
        throw new Error(t('A folder cannot be moved into itself.'))
      if (cut && parentOf(path) === dir) continue
      const name = cut ? baseName(path) : freeName(baseName(path), taken)
      if (cut && taken.has(name)) throw new Error(`"${name}" already exists in the destination.`)
      const destination = joinPath(dir, name)
      if (cut) {
        await invoke('files.rename', taskId, binding.repoId, path, destination)
        ws.renameFileViews(taskId, binding.repoId, path, destination)
      } else await invoke('files.copy', taskId, binding.repoId, path, destination)
      taken.add(name)
      done.push(destination)
    }
    return done
  }
  /**
   * Places items in `dir`, wherever they come from: inside this checkout they move or copy in place, from another
   * project on this host they are copied there (and a cut removes the originals), and from another computer they
   * travel through this app with progress. Returns whether it finished.
   */
  const placeInto = async (dir: string, source: PlaceSource, forceCopy = false): Promise<boolean> => {
    if (source.kind === 'tree' && sameCheckout(source)) {
      setBusy(true)
      try {
        await placed(dir, await arrange(dir, source.paths, source.cut && !forceCopy))
        return true
      } catch (reason) {
        fail(reason)
        await reloadAll()
        return false
      } finally {
        setBusy(false)
      }
    }
    const from = source.kind === 'system' ? LOCAL_HOST : source.hostId
    const paths = source.kind === 'system' ? source.paths : outermost(source.paths)
    if (from === host.id) {
      const owner = source.kind === 'tree' ? { taskId: source.taskId, repoId: source.repoId } : null
      const move = source.kind === 'tree' && source.cut && !forceCopy
      if (move && owner && hasDirty(paths, owner)) {
        fail(new Error(t('Save or close unsaved files in these items before moving them.')))
        return false
      }
      setBusy(true)
      try {
        const done = await invoke(
          'files.import',
          taskId,
          binding.repoId,
          dir,
          source.kind === 'system' ? paths : paths.map((path) => `${source.cwd}/${path}`),
        )
        if (move && owner) {
          const affected = viewsWithin(paths, owner)
          for (const path of paths) await invoke('files.delete', owner.taskId, owner.repoId, path)
          ws.closeViews(
            owner.taskId,
            affected.map((view) => view.id),
          )
        }
        await placed(dir, done)
        return true
      } catch (reason) {
        fail(reason)
        await reloadAll()
        return false
      } finally {
        setBusy(false)
      }
    }
    // Between computers a cut still copies: removing the originals on the other host is left to the person.
    try {
      const done = await withTransferToast<string[]>(
        {
          running: t('Copying to {0}…', { 0: hostName(host.id) }),
          done: (result) =>
            result.length === 1
              ? t('Copied {0} to {1}', { 0: baseName(result[0]!), 1: hostName(host.id) })
              : t('Copied {0} items to {1}', { 0: result.length, 1: hostName(host.id) }),
          ...(source.kind === 'tree' && source.cut
            ? { detail: t('The originals stay on {0}.', { 0: hostName(from) }) }
            : {}),
        },
        (signal, onProgress) =>
          copyBetweenHosts({
            from,
            source: source.kind === 'system' ? { paths } : { taskId: source.taskId, repoId: source.repoId, paths },
            to: host.id,
            target: { taskId, repoId: binding.repoId, dir },
            signal,
            onProgress,
          }),
      )
      if (!done) return false
      await placed(dir, done)
      return true
    } catch (reason) {
      fail(reason)
      return false
    }
  }
  /** Copies items of this remote host into this computer's Downloads folder and shows them there. */
  const download = (entries: DirEntry[]) =>
    void withTransferToast<string[]>(
      {
        running: t('Downloading to this computer…'),
        done: (result) =>
          result.length === 1
            ? t('Saved {0} to Downloads', { 0: result[0]! })
            : t('Saved {0} items to Downloads', { 0: result.length }),
      },
      (signal, onProgress) =>
        copyBetweenHosts({
          from: host.id,
          source: { taskId, repoId: binding.repoId, paths: outermost(entries.map((entry) => entry.path)) },
          to: LOCAL_HOST,
          target: { downloads: true },
          signal,
          onProgress,
        }),
    ).catch(fail)
  // Hovering a closed folder while dragging opens it, so a drop can reach any depth.
  const springTimer = useRef<{ path: string; timer: number } | null>(null)
  const cancelSpring = () => {
    if (springTimer.current) window.clearTimeout(springTimer.current.timer)
    springTimer.current = null
  }
  useEffect(() => cancelSpring, [])
  const springOpen = (entry: DirEntry) => {
    if (entry.kind !== 'dir' || open.has(entry.path)) return cancelSpring()
    if (springTimer.current?.path === entry.path) return
    cancelSpring()
    springTimer.current = {
      path: entry.path,
      timer: window.setTimeout(() => {
        springTimer.current = null
        toggle(entry.path)
      }, 700),
    }
  }
  const acceptsDrop = (event: DragEvent) =>
    !busy && (!!explorerClipboard.dragging || event.dataTransfer.types.includes('Files'))
  const dragOver = (event: DragEvent, dir: string) => {
    if (!acceptsDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    const dragging = explorerClipboard.dragging
    event.dataTransfer.dropEffect = dragging && sameCheckout(dragging) && !event.altKey ? 'move' : 'copy'
    setDropDir(dir)
  }
  const dropInto = (event: DragEvent, dir: string) => {
    cancelSpring()
    if (!acceptsDrop(event)) return
    event.preventDefault()
    event.stopPropagation()
    setDropDir(null)
    const dragging = explorerClipboard.dragging
    explorerClipboard.dragging = null
    // Within one checkout a drag moves (Option copies); from anywhere else it copies, leaving the originals.
    if (dragging) {
      void placeInto(dir, { kind: 'tree', ...dragging, cut: sameCheckout(dragging) && !event.altKey })
      return
    }
    const paths = [...event.dataTransfer.files].map((file) => ramu.pathForFile(file)).filter(Boolean)
    if (!paths.length) {
      fail(new Error(t('Could not read the dropped file paths.')))
      return
    }
    void placeInto(dir, { kind: 'system', paths })
  }
  const dirOfTarget = (entry: DirEntry) => (entry.kind === 'dir' ? entry.path : parentOf(entry.path))
  const selectRow = (entry: DirEntry, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): boolean => {
    shared.lastRepo = binding.repoId
    setShowFolderSelection(true)
    if (event.metaKey || event.ctrlKey) {
      setPicked((current) =>
        current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path],
      )
      anchor.current = entry.path
      return true
    }
    if (event.shiftKey && anchor.current) {
      const order = visible('').map((item) => item.path),
        a = order.indexOf(anchor.current),
        b = order.indexOf(entry.path)
      if (a >= 0 && b >= 0) {
        setPicked(order.slice(Math.min(a, b), Math.max(a, b) + 1))
        return true
      }
    }
    // Keep the folder as the target for file commands without showing expansion as selection.
    setShowFolderSelection(entry.kind !== 'dir')
    setPicked([entry.path])
    anchor.current = entry.path
    return false
  }
  const moveFocus = (path: string) =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLElement>(`.repo-tree [data-path="${CSS.escape(`${binding.repoId}:${path}`)}"]`)
        ?.focus(),
    )
  const onTreeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('input, textarea')) return
    const mod = event.metaKey || event.ctrlKey,
      key = event.key.toLowerCase()
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) || (mod && key === 'a'))
      setShowFolderSelection(true)
    if (mod && key === 'c' && picked.length) {
      event.preventDefault()
      setClip(picked, false)
    } else if (mod && key === 'x' && picked.length) {
      event.preventDefault()
      setClip(picked, true)
    } else if (mod && key === 'v') {
      event.preventDefault()
      const entry = pickedEntries[0]
      void paste(entry ? dirOfTarget(entry) : '')
    } else if (mod && key === 'a') {
      event.preventDefault()
      setPicked(visible('').map((entry) => entry.path))
    } else if (event.key === 'Delete' || (event.metaKey && event.key === 'Backspace')) {
      event.preventDefault()
      deletePicked()
    } else if (event.key === 'F2' && pickedEntries.length === 1) {
      event.preventDefault()
      begin({ type: 'rename', entry: pickedEntries[0]! })
    } else if (event.key === 'Escape' && picked.length > 1) setPicked(picked.slice(-1))
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      const order = visible('').map((entry) => entry.path),
        current = order.indexOf(picked.at(-1) ?? ''),
        next = order[Math.max(0, Math.min(order.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (!next) return
      if (event.shiftKey && anchor.current) {
        const a = order.indexOf(anchor.current),
          b = order.indexOf(next)
        setPicked(order.slice(Math.min(a, b), Math.max(a, b) + 1))
      } else {
        setPicked([next])
        anchor.current = next
      }
      moveFocus(next)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const entry = pickedEntries.at(-1)
      if (!entry) return
      event.preventDefault()
      if (entry.kind === 'dir' && (event.key === 'ArrowRight') !== open.has(entry.path)) toggle(entry.path)
      else if (event.key === 'ArrowLeft' && parentOf(entry.path)) {
        setPicked([parentOf(entry.path)])
        anchor.current = parentOf(entry.path)
        moveFocus(parentOf(entry.path))
      }
    }
  }
  // "New file" and "New folder" in the panel header go to the tree used last, inside the selected folder.
  useEffect(() => {
    const create = (event: Event) => {
      if (shared.lastRepo ? shared.lastRepo !== binding.repoId : !primary) return
      const entry = pickedEntries[0]
      begin({
        type: 'create',
        parent: entry ? dirOfTarget(entry) : '',
        kind: (event as CustomEvent<'file' | 'dir'>).detail,
      })
    }
    window.addEventListener('ramu:explorer-new', create)
    return () => window.removeEventListener('ramu:explorer-new', create)
  })
  const copy = async (path: string) => {
    try {
      await copyText(path)
    } catch (reason) {
      notifyError(errorText(reason), 'Explorer')
    }
  }
  const begin = (next: NonNullable<typeof action>) => {
    setError(null)
    setName(next.type === 'rename' ? next.entry.name : '')
    setAction(next)
  }
  const multi = picked.length > 1 && picked.includes(target.path)
  const targets = multi ? pickedEntries : [target]
  const pasteDir = dirOfTarget(target)
  const context = useContextMenu(
    'Explorer actions',
    explorerMenuEntries({
      hostId: host.id,
      isLocal: host.isLocal,
      ws,
      taskId,
      binding,
      target,
      targets,
      multi,
      busy,
      pasteDir,
      setClip,
      begin,
      deletePicked,
      placeInto,
      paste,
      download,
      systemFiles,
      copy,
      fail,
    }),
  )
  const confirmAction = async () => {
    if (!action) return
    setBusy(true)
    setError(null)
    try {
      if (action.type === 'create') {
        if (!isValidEntryName(name)) throw new Error(t('Enter a file or folder name without slashes.'))
        const path = action.parent ? `${action.parent}/${name}` : name
        await invoke('files.create', taskId, binding.repoId, path, action.kind)
        setOpen((current) => new Set([...current, action.parent, ...(action.kind === 'dir' ? [path] : [])]))
        await load(action.parent)
        if (action.kind === 'file') ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path, preview: false })
        else await load(path)
      } else if (action.type === 'delete') {
        const inside = (view: { path: string }) => action.entries.some((entry) => isWithin(view.path, entry.path))
        const affected = (ws.taskUi[ws.workspaceOf(taskId)]?.views ?? []).filter(
          (view) =>
            (view.kind === 'file' || (view.kind === 'diff' && !view.oid)) &&
            view.repoId === binding.repoId &&
            inside(view),
        )
        if (affected.some((view) => ws.dirty[view.id]))
          throw new Error(t('Save or close unsaved files in these items before continuing.'))
        for (const entry of action.entries) await invoke('files.delete', taskId, binding.repoId, entry.path)
        ws.closeViews(
          taskId,
          affected.map((view) => view.id),
        )
        setPicked([])
        await Promise.all([...new Set(action.entries.map((entry) => parentOf(entry.path)))].map(load))
      } else {
        const affected = (ws.taskUi[ws.workspaceOf(taskId)]?.views ?? []).filter(
          (view) =>
            (view.kind === 'file' || (view.kind === 'diff' && !view.oid)) &&
            view.repoId === binding.repoId &&
            isWithin(view.path, action.entry.path),
        )
        if (affected.some((view) => ws.dirty[view.id]))
          throw new Error(t('Save or close unsaved files in this item before continuing.'))
        const parent = parentOf(action.entry.path)
        if (!isValidEntryName(name)) throw new Error(t('Enter a file or folder name without slashes.'))
        const destination = joinPath(parent, name)
        if (destination !== action.entry.path) {
          await invoke('files.rename', taskId, binding.repoId, action.entry.path, destination)
          ws.renameFileViews(taskId, binding.repoId, action.entry.path, destination)
          const expanded = new Set(
            [...open].map((path) =>
              isWithin(path, action.entry.path) ? destination + path.slice(action.entry.path.length) : path,
            ),
          )
          setOpen(expanded)
          setPicked([destination])
          await Promise.all([...expanded].map(load))
        }
      }
      setAction(null)
      window.dispatchEvent(new Event('ramu:git-updated'))
    } catch (reason) {
      setError(errorText(reason))
    } finally {
      setBusy(false)
    }
  }

  const handlers: TreeRowHandlers = {
    onContextMenu: (event, e) => {
      setShowFolderSelection(true)
      shared.lastRepo = binding.repoId
      if (!picked.includes(e.path)) {
        setPicked([e.path])
        anchor.current = e.path
      }
      setTarget(e)
      void readSystemFiles()
      context.onContextMenu(event)
    },
    onContextKey: (event, e) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        setTarget(e)
        void readSystemFiles()
        context.onKeyDown(event)
      }
    },
    onDragOver: (event, e) => {
      dragOver(event, dirOfTarget(e))
      if (acceptsDrop(event)) springOpen(e)
    },
    onDragLeave: () => {
      cancelSpring()
      setDropDir(null)
    },
    onDrop: (event, e) => dropInto(event, dirOfTarget(e)),
    onDragEnd: () => {
      explorerClipboard.dragging = null
      cancelSpring()
      setDropDir(null)
    },
    onDragStart: (event, e) => {
      setShowFolderSelection(true)
      // Dragging a selected row takes the whole selection; any other row is dragged alone.
      const group = picked.includes(e.path) && pickedEntries.length > 1 ? pickedEntries : [e]
      if (group.length === 1) {
        setPicked([e.path])
        anchor.current = e.path
      }
      explorerClipboard.dragging = { ...here, paths: group.map((entry) => entry.path) }
      event.dataTransfer.setData(
        FILE_DRAG_TYPE,
        JSON.stringify({
          repoId: binding.repoId,
          path: e.path,
          kind: e.kind,
          items: group.map((entry) => ({ path: entry.path, kind: entry.kind })),
        }),
      )
      event.dataTransfer.effectAllowed = 'copyMove'
    },
    onOpenPinned: (e) => {
      if (e.kind === 'file') ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: e.path, preview: false })
    },
    onClick: (event, e) => {
      if (selectRow(e, event)) return
      if (e.kind === 'dir') toggle(e.path)
      else ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: e.path, preview: true })
    },
  }

  const render = (dir: string, depth: number) =>
    children[dir] === undefined ? (
      <ContentSkeleton rows={3} className="py-1" />
    ) : (
      children[dir].map((e) => {
        const isFile = e.kind !== 'dir'
        return (
          <div key={e.path}>
            <TreeRow
              entry={e}
              depth={depth}
              repoId={binding.repoId}
              isOpen={open.has(e.path)}
              isSelected={isFile && e.path === selectedPath}
              isPicked={picked.includes(e.path) && (isFile || showFolderSelection)}
              isDropTarget={dropDir === e.path}
              rowRef={isFile && e.path === selectedPath ? selectedRow : undefined}
              handlers={handlers}
            />
            {e.kind === 'dir' && open.has(e.path) && (
              <div
                className={TREE_CHILDREN_CLASS}
                style={{ '--tree-guide-left': `${14 + depth * 12}px` } as CSSProperties}
              >
                {render(e.path, depth + 1)}
              </div>
            )}
          </div>
        )
      })
    )

  return (
    <div
      className={REPO_TREE_CLASS}
      onDragOver={(event) => dragOver(event, '')}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDir(null)
      }}
      onDrop={(event) => dropInto(event, '')}
      onKeyDown={onTreeKey}
      onFocusCapture={() => {
        shared.lastRepo = binding.repoId
      }}
    >
      {context.menu}
      {action && (
        <ActionDialog
          action={action}
          repoName={binding.repoName}
          name={name}
          setName={setName}
          nameInput={nameInput}
          busy={busy}
          error={error}
          onCancel={() => {
            if (!busy) setAction(null)
          }}
          onConfirm={() => void confirmAction()}
        />
      )}
      <Button
        variant="tree"
        className={`${TREE_ROOT_CLASS}${dropDir === '' ? ' drop-target' : ''}`}
        onDragOver={(event) => dragOver(event, '')}
        onDragLeave={() => setDropDir(null)}
        onDrop={(event) => dropInto(event, '')}
        onContextMenu={(event) => {
          setTarget({ name: binding.repoName, path: '', kind: 'dir' })
          void readSystemFiles()
          context.onContextMenu(event)
        }}
        onKeyDown={(event) => {
          if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
            setTarget({ name: binding.repoName, path: '', kind: 'dir' })
            context.onKeyDown(event)
          }
        }}
        onClick={() => toggle('')}
        title={binding.cwd}
      >
        <TreeCaret open={open.has('')} />
        <span className="strong font-semibold">{binding.repoName}</span>
        <span className="muted text-muted-foreground small text-caption">
          {binding.folderOnly ? 'folder' : binding.mode === 'worktree' ? binding.taskBranch : 'checkout'}
        </span>
      </Button>
      {open.has('') && (
        <div className={TREE_CHILDREN_CLASS} style={{ '--tree-guide-left': '14px' } as CSSProperties}>
          {render('', 1)}
        </div>
      )}
    </div>
  )
}
