import { FILE_ROW, FileRowLabel } from './FileRow'
import { ContentSkeleton } from '@/components/content-skeleton'
import { visibleName } from '@ramu/shared/text'
import { OverlayScrollArea } from '@/components/overlay-scroll-area'
import { t, useLanguage } from './../i18n'
import { Button } from '@/components/desktop-button'
import { Input } from '@/components/ui/input'
import { ChevronRight, FileText, Folder, FolderOpen, FilePlus, FolderPlus, Copy, Pencil, Trash2, SquareTerminal, RefreshCw, ListCollapse, ClipboardPaste, CopyPlus, Scissors } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useLayoutEffect, type CSSProperties, type DragEvent } from 'react'
import type { DirEntry, RepositoryBinding } from '@ramu/shared/types'
import { Dialog, useContextMenu } from '../Menu'
import { notifyError } from '../Notifications'
import { errorText } from '../TaskPane'
import { ipcQueryKey } from '../dataQueries'
import { useQueries } from '@tanstack/react-query'
import { invoke, ramu, copyText } from '../ipc'
import { FILE_DRAG_TYPE } from '../ComposerSuggestions'
import { useWorkspace } from '../workspace'

type Clip = { taskId: string; repoId: string; paths: string[]; cut: boolean }
/** Shared by every repository tree: what was cut or copied, which tree was used last, and what is being dragged. */
let clip: Clip | null = null
let lastRepo: string | null = null
let dragging: { repoId: string; cwd: string; paths: string[] } | null = null
const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)
const parentOf = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
const joinPath = (dir: string, name: string) => dir ? `${dir}/${name}` : name
/** "name copy.ext", "name copy 2.ext" … until the name is free. */
function freeName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.'), stem = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 1; ; n++) { const next = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`; if (!taken.has(next)) return next }
}

export function ExplorerPanel() {
  useLanguage()
  const ws = useWorkspace()
  const taskId = ws.ui.activeTaskId
  if (!taskId) return <NoTask />
  const bindings = ws.bindings[taskId] ?? []
  return (
    <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px] explorer-panel [&_>_.explorer-title]:flex-none [&_>_.explorer-context]:flex-none [&_.tree-root-children::before]:hidden [&_.tree-row]:h-7 [&_.tree-row]:min-h-7 [&_.tree-row]:whitespace-nowrap [&_.tree-row]:overflow-hidden [&_.tree-root]:h-7 [&_.tree-root]:min-h-7 [&_.tree-root]:sticky [&_.tree-root]:top-0 [&_.tree-root]:z-40 [&_.tree-root]:mb-0 [&_.tree-root]:whitespace-nowrap [&_.tree-root]:overflow-hidden [&_.tree-folder-sticky]:sticky [&_.tree-folder-sticky]:top-[var(--tree-sticky-top)] [&_.tree-folder-sticky]:z-[var(--tree-sticky-layer)] [&_.tree-name]:flex-initial [&_.tree-name]:min-w-0 [&_.tree-name]:overflow-hidden [&_.tree-name]:text-ellipsis [&_.tree-name]:whitespace-nowrap flex flex-col w-full h-full min-h-0 pb-0">
      <header className="panel-title text-chat font-semibold tracking-[-0.01em] text-foreground m-[4px_0_8px] overflow-hidden text-ellipsis whitespace-nowrap explorer-title [&_.icon]:w-[var(--action-size)] [&_.icon]:h-[var(--action-size)] [&_.icon_>_svg]:w-[var(--icon-size)] [&_.icon_>_svg]:h-[var(--icon-size)] flex items-center gap-1"><span className="grow flex-1 min-w-0 text-left" /><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("New file")} aria-label={t("New file")} onClick={() => window.dispatchEvent(new CustomEvent('ramu:explorer-new', { detail: 'file' }))}><FilePlus size={14} /></Button><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("New folder")} aria-label={t("New folder")} onClick={() => window.dispatchEvent(new CustomEvent('ramu:explorer-new', { detail: 'dir' }))}><FolderPlus size={14} /></Button><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Refresh explorer")} aria-label={t("Refresh explorer")} onClick={() => window.dispatchEvent(new Event('ramu:refresh-explorer'))}><RefreshCw size={14} /></Button><Button variant="ghost" size="icon-xs" className="ghost bg-transparent border-transparent text-muted-foreground hover:bg-hover hover:text-foreground aria-expanded:bg-hover icon p-0 size-(--action-size) flex-none justify-center small-icon p-0 size-(--action-compact)" title={t("Collapse folders")} aria-label={t("Collapse explorer folders")} onClick={() => window.dispatchEvent(new Event('ramu:collapse-explorer'))}><ListCollapse size={14} /></Button></header>
      <OverlayScrollArea className="explorer-scroll-area flex-1 min-h-0" viewportClassName="explorer-tree-scroll flex-1 min-h-0 overflow-auto pb-3" contentClassName="min-h-full flex flex-col [&>.repo-tree:last-child]:flex-1">
      {bindings.map((b, index) =>
        b.setupState === 'ready' ? (
          <RepoTree key={`${ws.workspaceOf(taskId)}:${b.repoId}`} taskId={taskId} binding={b} primary={index === 0} />
        ) : (
          <div key={b.repoId} className="muted text-muted-foreground">
            {b.repoName}: worktree {b.setupState}
          </div>
        ),
      )}
      </OverlayScrollArea>
    </div>
  )
}

export function NoTask() {
  useLanguage()
  return (
    <div className="panel [&_>_.hint]:m-[8px_0_12px] [&_>_.hint]:p-[4px_8px] [&_>_.hint]:leading-[1.55] [&_>_.hint]:[overflow-wrap:anywhere] [&_:is(.scm-empty,_.empty-tasks)]:m-[8px_0] [&_:is(.scm-empty,_.empty-tasks)]:p-2 [&_:is(.scm-empty,_.empty-tasks)]:leading-[1.5] [&_:is(.scm-empty,_.empty-tasks)]:[overflow-wrap:anywhere] p-[2px_8px_16px]">
      <p className="muted text-muted-foreground hint m-[4px_0_8px] text-control leading-[1.5]">{t("Open a project or chat to see its files here.")}</p>
    </div>
  )
}

function RepoTree({ taskId, binding, primary }: { taskId: string; binding: RepositoryBinding; primary: boolean }) {
  useLanguage()
  const ws = useWorkspace()
  const [open, setOpen] = useState<Set<string>>(new Set(['']))
  const directories = [...open]
  const listings = useQueries({ queries: directories.map(dir => ({ queryKey: ipcQueryKey('files.list', taskId, binding.repoId, dir), queryFn: () => ramu.invoke('files.list', taskId, binding.repoId, dir) })) })
  const children: Record<string, DirEntry[]> = {}
  directories.forEach((dir, index) => { const data = listings[index]?.data; if (data) children[dir] = data })
  const [target, setTarget] = useState<DirEntry>({ name: binding.repoName, path: '', kind: 'dir' })
  const [action, setAction] = useState<{ type: 'create'; parent: string; kind: 'file' | 'dir' } | { type: 'rename'; entry: DirEntry } | { type: 'delete'; entries: DirEntry[] } | null>(null)
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [showFolderSelection, setShowFolderSelection] = useState(true)
  const anchor = useRef<string | null>(null)
  const [dropDir, setDropDir] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameInput = useRef<HTMLInputElement>(null)
  useLayoutEffect(() => { if (action && action.type !== 'delete') { nameInput.current?.focus(); nameInput.current?.select() } }, [action])
  const selectedRow = useRef<HTMLButtonElement>(null)
  const pendingReveal = useRef<string | null>(null)
  const state = ws.taskUi[taskId]
  const active = state?.views.find((view) => view.id === state.activeViewId)
  const shared = ws.taskUi[ws.workspaceOf(taskId)]
  const lastFile = shared?.views.find((view) => view.id === shared.activeViewId)
  const selected = active?.kind === 'file' || active?.kind === 'diff' ? active : lastFile
  const selectedPath = selected && (selected.kind === 'file' || selected.kind === 'diff') && selected.repoId === binding.repoId ? selected.path : null

  const load = useCallback(
    async (dir: string) => {
      await invoke('files.list', taskId, binding.repoId, dir).catch(() => [])
    },
    [taskId, binding.repoId],
  )

  useEffect(() => {
    if (!selectedPath) void load('')
  }, [load, selectedPath])

  // Reveal the active file without changing which activity sidebar the user chose.
  useEffect(() => {
    if (!selectedPath) return
    pendingReveal.current = selectedPath
    const parts = selectedPath.split('/')
    const ancestors = ['', ...parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))]
    setOpen((current) => new Set([...current, ...ancestors]))
    void Promise.all(ancestors.map(load))
  }, [selectedPath, load])

  useEffect(() => {
    if (!selectedPath || pendingReveal.current !== selectedPath || !selectedRow.current) return
    selectedRow.current.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    pendingReveal.current = null
  }, [children, open, selectedPath])

  // Re-list expanded directories when something inside them changes on disk.
  useEffect(
    () =>
      ramu.on('fs:changed', ({ cwd, path }) => {
        if (cwd !== binding.cwd || path.startsWith('.git/')) return
        const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
        if (open.has(parent)) void load(parent)
      }),
    [binding.cwd, open, load],
  )

  const toggle = (dir: string) => {
    setOpen((s) => {
      const next = new Set(s)
      if (next.has(dir)) next.delete(dir)
      else {
        next.add(dir)
        if (!children[dir]) void load(dir)
      }
      return next
    })
  }

  useEffect(() => {
    const refresh = () => { void Promise.all([...open].map(load)) }
    const collapse = () => setOpen(new Set(['']))
    window.addEventListener('ramu:refresh-explorer', refresh)
    window.addEventListener('ramu:collapse-explorer', collapse)
    return () => { window.removeEventListener('ramu:refresh-explorer', refresh); window.removeEventListener('ramu:collapse-explorer', collapse) }
  }, [open, load])
  // ---- selection, clipboard, drag and drop ----
  const entryAt = (path: string): DirEntry | undefined => (children[parentOf(path)] ?? []).find((entry) => entry.path === path)
  const visible = (dir: string): DirEntry[] => (children[dir] ?? []).flatMap((entry) => entry.kind === 'dir' && open.has(entry.path) ? [entry, ...visible(entry.path)] : [entry])
  const pickedEntries = picked.map(entryAt).filter((entry): entry is DirEntry => !!entry)
  const deletePicked = (clicked?: DirEntry) => {
    const entries = clicked && !picked.includes(clicked.path) ? [clicked] : pickedEntries.length ? pickedEntries : clicked ? [clicked] : []
    if (entries.length) begin({ type: 'delete', entries })
  }
  const reloadAll = async () => { await Promise.all([...open].map(load)) }
  const fail = (reason: unknown) => notifyError(errorText(reason), 'Explorer')
  const hasDirty = (paths: string[]) => (ws.taskUi[ws.workspaceOf(taskId)]?.views ?? []).some((view) => (view.kind === 'file' || view.kind === 'diff' && !view.oid) && view.repoId === binding.repoId && ws.dirty[view.id] && paths.some((path) => view.path === path || view.path.startsWith(`${path}/`)))
  const setClip = (paths: string[], cut: boolean) => { if (paths.length) clip = { taskId, repoId: binding.repoId, paths, cut } }
  /** Pastes into `dir`: a copy gets a free name, a cut moves (and keeps its name). */
  const pasteInto = async (dir: string, source = clip, forceCopy = false) => {
    if (!source || source.repoId !== binding.repoId || source.taskId !== taskId && source.repoId !== binding.repoId) { if (source) fail(new Error('Paste into the same repository the items came from.')); return }
    const cut = source.cut && !forceCopy
    if (cut && hasDirty(source.paths)) { fail(new Error('Save or close unsaved files in these items before moving them.')); return }
    setBusy(true)
    try {
      const listing = await invoke('files.list', taskId, binding.repoId, dir).catch(() => [])
      const taken = new Set(listing.map((entry) => entry.name)), done: string[] = []
      for (const path of source.paths.filter((path) => !source.paths.some((parent) => path !== parent && path.startsWith(`${parent}/`)))) {
        if (cut && (path === dir || dir.startsWith(`${path}/`))) throw new Error('A folder cannot be moved into itself.')
        if (cut && parentOf(path) === dir) continue
        const name = cut ? baseName(path) : freeName(baseName(path), taken)
        if (cut && taken.has(name)) throw new Error(`"${name}" already exists in the destination.`)
        const destination = joinPath(dir, name)
        if (cut) { await invoke('files.rename', taskId, binding.repoId, path, destination); ws.renameFileViews(taskId, binding.repoId, path, destination) }
        else await invoke('files.copy', taskId, binding.repoId, path, destination)
        taken.add(name); done.push(destination)
      }
      if (cut && source === clip) clip = null
      setOpen((current) => new Set([...current, dir]))
      await reloadAll()
      if (done.length) { setPicked(done); anchor.current = done[0]! }
      window.dispatchEvent(new Event('ramu:git-updated'))
    } catch (reason) { fail(reason); await reloadAll() }
    finally { setBusy(false) }
  }
  const acceptsDrop = (event: DragEvent) => !busy && (!!dragging || event.dataTransfer.types.includes('Files'))
  const dragOver = (event: DragEvent, dir: string) => {
    if (!acceptsDrop(event)) return
    event.preventDefault(); event.stopPropagation()
    event.dataTransfer.dropEffect = dragging?.repoId === binding.repoId && dragging.cwd === binding.cwd && !event.altKey ? 'move' : 'copy'
    setDropDir(dir)
  }
  const dropInto = (event: DragEvent, dir: string) => {
    if (!acceptsDrop(event)) return
    event.preventDefault(); event.stopPropagation(); setDropDir(null)
    const source = dragging; dragging = null
    if (source?.repoId === binding.repoId && source.cwd === binding.cwd) {
      void pasteInto(dir, { taskId, repoId: binding.repoId, paths: source.paths, cut: !event.altKey })
      return
    }
    // Desktop and other repositories are copied, leaving their originals in place.
    const paths = source ? source.paths.map((path) => `${source.cwd}/${path}`) : [...event.dataTransfer.files].map((file) => ramu.pathForFile(file)).filter(Boolean)
    if (!paths.length) { fail(new Error('Could not read the dropped file paths.')); return }
    setBusy(true)
    void (async () => {
      try {
        const done = await invoke('files.import', taskId, binding.repoId, dir, paths)
        setOpen((current) => new Set([...current, dir]))
        setPicked(done); anchor.current = done[0] ?? null
        window.dispatchEvent(new Event('ramu:git-updated'))
      } catch (reason) { fail(reason) }
      finally { await reloadAll(); setBusy(false) }
    })()
  }
  const dirOfTarget = (entry: DirEntry) => entry.kind === 'dir' ? entry.path : parentOf(entry.path)
  const selectRow = (entry: DirEntry, event: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }): boolean => {
    lastRepo = binding.repoId
    setShowFolderSelection(true)
    if (event.metaKey || event.ctrlKey) {
      setPicked((current) => current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path]); anchor.current = entry.path
      return true
    }
    if (event.shiftKey && anchor.current) {
      const order = visible('').map((item) => item.path), a = order.indexOf(anchor.current), b = order.indexOf(entry.path)
      if (a >= 0 && b >= 0) { setPicked(order.slice(Math.min(a, b), Math.max(a, b) + 1)); return true }
    }
    // Keep the folder as the target for file commands without showing expansion as selection.
    setShowFolderSelection(entry.kind !== 'dir')
    setPicked([entry.path]); anchor.current = entry.path
    return false
  }
  const moveFocus = (path: string) => requestAnimationFrame(() => document.querySelector<HTMLElement>(`.repo-tree [data-path="${CSS.escape(`${binding.repoId}:${path}`)}"]`)?.focus())
  const onTreeKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof Element && event.target.closest('input, textarea')) return
    const mod = event.metaKey || event.ctrlKey, key = event.key.toLowerCase()
    if (['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) || mod && key === 'a') setShowFolderSelection(true)
    if (mod && key === 'c' && picked.length) { event.preventDefault(); setClip(picked, false) }
    else if (mod && key === 'x' && picked.length) { event.preventDefault(); setClip(picked, true) }
    else if (mod && key === 'v' && clip) { event.preventDefault(); const entry = pickedEntries[0]; void pasteInto(entry ? dirOfTarget(entry) : '') }
    else if (mod && key === 'a') { event.preventDefault(); setPicked(visible('').map((entry) => entry.path)) }
    else if (event.key === 'Delete' || event.metaKey && event.key === 'Backspace') { event.preventDefault(); deletePicked() }
    else if (event.key === 'F2' && pickedEntries.length === 1) { event.preventDefault(); begin({ type: 'rename', entry: pickedEntries[0]! }) }
    else if (event.key === 'Escape' && picked.length > 1) setPicked(picked.slice(-1))
    else if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
      event.preventDefault()
      const order = visible('').map((entry) => entry.path), current = order.indexOf(picked.at(-1) ?? ''), next = order[Math.max(0, Math.min(order.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))]
      if (!next) return
      if (event.shiftKey && anchor.current) { const a = order.indexOf(anchor.current), b = order.indexOf(next); setPicked(order.slice(Math.min(a, b), Math.max(a, b) + 1)) } else { setPicked([next]); anchor.current = next }
      moveFocus(next)
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      const entry = pickedEntries.at(-1)
      if (!entry) return
      event.preventDefault()
      if (entry.kind === 'dir' && (event.key === 'ArrowRight') !== open.has(entry.path)) toggle(entry.path)
      else if (event.key === 'ArrowLeft' && parentOf(entry.path)) { setPicked([parentOf(entry.path)]); anchor.current = parentOf(entry.path); moveFocus(parentOf(entry.path)) }
    }
  }
  // "New file" and "New folder" in the panel header go to the tree used last, inside the selected folder.
  useEffect(() => {
    const create = (event: Event) => {
      if (lastRepo ? lastRepo !== binding.repoId : !primary) return
      const entry = pickedEntries[0]
      begin({ type: 'create', parent: entry ? dirOfTarget(entry) : '', kind: (event as CustomEvent<'file' | 'dir'>).detail })
    }
    window.addEventListener('ramu:explorer-new', create)
    return () => window.removeEventListener('ramu:explorer-new', create)
  })
  const copy = async (path: string) => { try { await copyText(path) } catch (reason) { notifyError(errorText(reason), 'Explorer') } }
  const begin = (next: NonNullable<typeof action>) => { setError(null); setName(next.type === 'rename' ? next.entry.name : ''); setAction(next) }
  const multi = picked.length > 1 && picked.includes(target.path)
  const targets = multi ? pickedEntries : [target]
  const pasteDir = dirOfTarget(target)
  const context = useContextMenu('Explorer actions', multi ? [
    { key: 'cut', label: <><Scissors size={14} />{t("Cut ")}{targets.length} {t(" items")}</>, onSelect: () => setClip(targets.map((entry) => entry.path), true) },
    { key: 'copy', label: <><Copy size={14} />{t("Copy ")}{targets.length} {t(" items")}</>, onSelect: () => setClip(targets.map((entry) => entry.path), false) },
    { key: 'copy-paths', label: t("Copy paths"), onSelect: () => void copy(targets.map((entry) => `${binding.cwd}/${entry.path}`).join('\n')) },
    { key: 'copy-relative', label: t("Copy relative paths"), onSelect: () => void copy(targets.map((entry) => entry.path).join('\n')) },
    { key: 'separator', separator: true as const },
    { key: 'delete', label: <><Trash2 size={14} />{t("Delete {0} items…", { "0": targets.length })}</>, disabled: busy, danger: true, onSelect: () => deletePicked(target) },
  ] : [
    ...(target.kind === 'dir' ? [
      { key: 'new-file', label: <><FilePlus size={14} />{t("New file…")}</>, disabled: busy, onSelect: () => begin({ type: 'create', parent: target.path, kind: 'file' }) },
      { key: 'new-folder', label: <><FolderPlus size={14} />{t("New folder…")}</>, disabled: busy, onSelect: () => begin({ type: 'create', parent: target.path, kind: 'dir' }) },
      { key: 'terminal', label: <><SquareTerminal size={14} />{t("Open terminal in ")}{binding.folderOnly ? 'folder' : t("repository")}</>, onSelect: () => ws.openView(taskId, { kind: 'terminal', repoId: binding.repoId }) },
    ] : [{ key: 'open', label: <><FileText size={14} />{t("Open file")}</>, onSelect: () => ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: target.path }) }]),
    { key: 'separator-edit', separator: true as const },
    ...(target.path ? [
      { key: 'cut', label: <><Scissors size={14} />{t("Cut")}</>, onSelect: () => setClip([target.path], true) },
      { key: 'copy', label: <><Copy size={14} />{t("Copy")}</>, onSelect: () => setClip([target.path], false) },
    ] : []),
    { key: 'paste', label: <><ClipboardPaste size={14} />{t("Paste")}{clip ? ` ${clip.paths.length === 1 ? baseName(clip.paths[0]!) : `${clip.paths.length} items`}` : ''}</>, disabled: busy || !clip || clip.repoId !== binding.repoId, onSelect: () => void pasteInto(pasteDir) },
    ...(target.path ? [{ key: 'duplicate', label: <><CopyPlus size={14} />{t("Duplicate")}</>, disabled: busy, onSelect: () => void pasteInto(parentOf(target.path), { taskId, repoId: binding.repoId, paths: [target.path], cut: false }) }] : []),
    { key: 'separator-paths', separator: true as const },
    { key: 'reveal', label: <><FolderOpen size={14} />{t("Reveal in Finder")}</>, onSelect: () => { void invoke('files.reveal', taskId, binding.repoId, target.path).catch(fail) } },
    { key: 'copy-path', label: <><Copy size={14} />{t("Copy path")}</>, onSelect: () => void copy(target.path ? `${binding.cwd}/${target.path}` : binding.cwd) },
    { key: 'copy-relative', label: t("Copy relative path"), onSelect: () => void copy(target.path || '.') },
    ...(target.path ? [
      { key: 'separator', separator: true as const },
      { key: 'rename', label: <><Pencil size={14} />{t("Rename…")}</>, disabled: busy, onSelect: () => begin({ type: 'rename', entry: target }) },
      { key: 'delete', label: <><Trash2 size={14} />{t("Delete…")}</>, disabled: busy, danger: true, onSelect: () => deletePicked(target) },
    ] : []),
  ])
  const confirmAction = async () => {
    if (!action) return
    setBusy(true); setError(null)
    try {
      if (action.type === 'create') {
        if (!name.trim() || /[\/\\]/.test(name) || name === '.' || name === '..') throw new Error('Enter a file or folder name without slashes.')
        const path = action.parent ? `${action.parent}/${name}` : name
        await invoke('files.create', taskId, binding.repoId, path, action.kind)
        setOpen((current) => new Set([...current, action.parent, ...(action.kind === 'dir' ? [path] : [])]))
        await load(action.parent)
        if (action.kind === 'file') ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path, preview: false })
        else await load(path)
      } else if (action.type === 'delete') {
        const inside = (view: { path: string }) => action.entries.some((entry) => view.path === entry.path || view.path.startsWith(`${entry.path}/`))
        const affected = (ws.taskUi[ws.workspaceOf(taskId)]?.views ?? []).filter((view) => (view.kind === 'file' || view.kind === 'diff' && !view.oid) && view.repoId === binding.repoId && inside(view))
        if (affected.some((view) => ws.dirty[view.id])) throw new Error('Save or close unsaved files in these items before continuing.')
        for (const entry of action.entries) await invoke('files.delete', taskId, binding.repoId, entry.path)
        ws.closeViews(taskId, affected.map((view) => view.id))
        setPicked([])
        await Promise.all([...new Set(action.entries.map((entry) => parentOf(entry.path)))].map(load))
      } else {
        const affected = (ws.taskUi[ws.workspaceOf(taskId)]?.views ?? []).filter((view) => (view.kind === 'file' || view.kind === 'diff' && !view.oid) && view.repoId === binding.repoId && (view.path === action.entry.path || view.path.startsWith(`${action.entry.path}/`)))
        if (affected.some((view) => ws.dirty[view.id])) throw new Error('Save or close unsaved files in this item before continuing.')
        const parent = parentOf(action.entry.path)
        if (!name.trim() || /[\/\\]/.test(name) || name === '.' || name === '..') throw new Error('Enter a file or folder name without slashes.')
        const destination = joinPath(parent, name)
        if (destination !== action.entry.path) {
          await invoke('files.rename', taskId, binding.repoId, action.entry.path, destination)
          ws.renameFileViews(taskId, binding.repoId, action.entry.path, destination)
          const expanded = new Set([...open].map((path) => path === action.entry.path || path.startsWith(`${action.entry.path}/`) ? destination + path.slice(action.entry.path.length) : path))
          setOpen(expanded); setPicked([destination])
          await Promise.all([...expanded].map(load))
        }
      }
      setAction(null)
      window.dispatchEvent(new Event('ramu:git-updated'))
    } catch (reason) { setError(errorText(reason)) }
    finally { setBusy(false) }
  }

  const render = (dir: string, depth: number) =>
    children[dir] === undefined ? <ContentSkeleton rows={3} className="py-1" /> : children[dir].map((e) => (
      <div key={e.path}>
        <Button variant="tree"
          ref={e.kind !== 'dir' && e.path === selectedPath ? selectedRow : undefined}
          data-path={`${binding.repoId}:${e.path}`}
          className={`tree-row [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&.selected]:bg-accent [&.selected]:text-foreground [&.selected]:[box-shadow:none] [&.selected:hover]:bg-accent [&.selected:hover]:text-foreground [&.selected:hover]:[box-shadow:none] [&:focus-visible]:[outline-color:var(--line-strong)] [&[draggable='true']]:[-webkit-user-drag:element] [&.picked]:bg-accent [&.picked]:text-foreground [&.drop-target]:bg-brand-wash [&.drop-target]:[box-shadow:none] ${FILE_ROW} w-full bg-transparent [border:none] p-[3px_4px] text-left justify-start${e.kind === 'dir' && open.has(e.path) ? ' tree-folder-sticky' : ''}${e.kind !== 'dir' && e.path === selectedPath ? ' selected' : ''}${picked.includes(e.path) && (e.kind !== 'dir' || showFolderSelection) ? ' picked' : ''}${dropDir === e.path ? ' drop-target' : ''}`}
          aria-expanded={e.kind === 'dir' ? open.has(e.path) : undefined}
          aria-current={e.kind !== 'dir' && e.path === selectedPath ? 'page' : undefined}
          onContextMenu={(event) => { setShowFolderSelection(true); lastRepo = binding.repoId; if (!picked.includes(e.path)) { setPicked([e.path]); anchor.current = e.path } setTarget(e); context.onContextMenu(event) }}
          onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { setTarget(e); context.onKeyDown(event) } }}
          onDragOver={(event) => dragOver(event, dirOfTarget(e))}
          onDragLeave={() => setDropDir(null)}
          onDrop={(event) => dropInto(event, dirOfTarget(e))}
          onDragEnd={() => { dragging = null; setDropDir(null) }}
          title={e.path}
          draggable
          onDragStart={(event) => {
            setShowFolderSelection(true)
            // Dragging a selected row takes the whole selection; any other row is dragged alone.
            const group = picked.includes(e.path) && pickedEntries.length > 1 ? pickedEntries : [e]
            if (group.length === 1) { setPicked([e.path]); anchor.current = e.path }
            dragging = { repoId: binding.repoId, cwd: binding.cwd, paths: group.map((entry) => entry.path) }
            event.dataTransfer.setData(FILE_DRAG_TYPE, JSON.stringify({ repoId: binding.repoId, path: e.path, kind: e.kind, items: group.map((entry) => ({ path: entry.path, kind: entry.kind })) }))
            event.dataTransfer.effectAllowed = 'copyMove'
          }}
          style={{ paddingLeft: 8 + depth * 12, '--tree-sticky-top': `calc(${depth} * var(--tree-row-height))`, '--tree-sticky-layer': Math.max(2, 40 - depth), scrollMarginTop: `calc(${depth + 1} * var(--tree-row-height))` } as CSSProperties}
          onDoubleClick={() => { if (e.kind === 'file') ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: e.path, preview: false }) }}
          onClick={(event) => { if (selectRow(e, event)) return; if (e.kind === 'dir') toggle(e.path); else ws.openView(taskId, { kind: 'file', repoId: binding.repoId, path: e.path, preview: true }) }}
        >
          <span className="tree-row-guides" aria-hidden="true">{Array.from({ length: depth }, (_, index) => <span key={index} className="tree-row-guide" style={{ left: 14 + index * 12 }} />)}</span>
          {e.kind === 'dir' ? (
            <>
              <ChevronRight size={12} className={open.has(e.path) ? 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)] open' : 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)]'} />
              {open.has(e.path) ? <FolderOpen size={14} className="tree-icon [.commit-file-A_&]:text-ok [.commit-file-D_&]:text-bad flex-none text-muted-foreground" /> : <Folder size={14} className="tree-icon [.commit-file-A_&]:text-ok [.commit-file-D_&]:text-bad flex-none text-muted-foreground" />}
              <span className="tree-name relative top-[-1px] min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{visibleName(e.name)}</span>
            </>
          ) : (
            <FileRowLabel path={e.path} name={visibleName(e.name)} />
          )}
        </Button>
        {e.kind === 'dir' && open.has(e.path) && <div className="tree-children [&::before]:[content:''] [&::before]:absolute [&::before]:top-0 [&::before]:bottom-0 [&::before]:left-[var(--tree-guide-left)] [&::before]:w-px [&::before]:[background:var(--line)] [&::before]:pointer-events-none [&::before]:z-1 relative" style={{ '--tree-guide-left': `${14 + depth * 12}px` } as CSSProperties}>{render(e.path, depth + 1)}</div>}
      </div>
    ))

  return (
    <div className="repo-tree [&:hover_.tree-children::before]:[background:var(--line-strong)] mb-1.5" onDragOver={(event) => dragOver(event, '')} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropDir(null) }} onDrop={(event) => dropInto(event, '')} onKeyDown={onTreeKey} onFocusCapture={() => { lastRepo = binding.repoId }}>
      {context.menu}
      {action && <Dialog title={action.type === 'create' ? action.kind === 'file' ? t("New file") : t("New folder") : action.type === 'rename' ? t("Rename") : t("Delete permanently?")} confirmLabel={action.type === 'create' ? t("Create") : action.type === 'rename' ? t("Rename") : t("Delete")} danger={action.type === 'delete'} busy={busy} error={error} onCancel={() => { if (!busy) setAction(null) }} onConfirm={() => void confirmAction()}>
        {action.type === 'delete' ? <><p>{action.entries.length === 1 ? t("This item and its contents will be deleted permanently.") : t("These {0} items and their contents will be deleted permanently.", { "0": action.entries.length })}</p><pre className="confirm-paths max-h-[240px] overflow-auto p-2.5 [border:1px_solid_transparent] rounded-(--radius-s) text-caption bg-fill">{action.entries.map((entry) => entry.path).join('\n')}</pre></> : <><label className="explorer-name-field [&_input]:w-full flex flex-col items-stretch">{t("Name")}<Input ref={nameInput} value={name} maxLength={255} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !busy) void confirmAction() }} /></label><p className="muted text-muted-foreground small text-caption">{binding.repoName}{action.type === 'create' && action.parent ? ` / ${action.parent}` : ''}</p></>}
      </Dialog>}
      <Button variant="tree" className={`tree-root [&:hover:not(:disabled)]:bg-hover [&:hover:not(:disabled)]:[border:none] [&:hover:not(:disabled)]:text-foreground [&:focus-visible]:[outline-color:var(--line-strong)] [&_>_span]:relative [&_>_span]:top-[-1px] [&.drop-target]:bg-brand-wash [&.drop-target]:[box-shadow:none] flex items-center w-full bg-transparent [border:none] rounded-(--radius-s) p-[3px_4px] gap-1.5 text-left whitespace-nowrap text-soft mb-0.5 justify-start${dropDir === '' ? ' drop-target' : ''}`} onDragOver={(event) => dragOver(event, '')} onDragLeave={() => setDropDir(null)} onDrop={(event) => dropInto(event, '')} onContextMenu={(event) => { setTarget({ name: binding.repoName, path: '', kind: 'dir' }); context.onContextMenu(event) }} onKeyDown={(event) => { if (event.key === 'ContextMenu' || event.shiftKey && event.key === 'F10') { setTarget({ name: binding.repoName, path: '', kind: 'dir' }); context.onKeyDown(event) } }} onClick={() => toggle('')} title={binding.cwd}>
        <ChevronRight size={12} className={open.has('') ? 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)] open' : 'tree-caret [&.open]:[transform:rotate(90deg)] w-3 flex-none text-muted-foreground [transition:transform_0.12s_var(--ease)]'} />
        <span className="strong font-semibold">{binding.repoName}</span>
        <span className="muted text-muted-foreground small text-caption">{binding.folderOnly ? 'folder' : binding.mode === 'worktree' ? binding.taskBranch : 'checkout'}</span>
      </Button>
      {open.has('') && <div className="tree-children [&::before]:[content:''] [&::before]:absolute [&::before]:top-0 [&::before]:bottom-0 [&::before]:left-[var(--tree-guide-left)] [&::before]:w-px [&::before]:[background:var(--line)] [&::before]:pointer-events-none [&::before]:z-1 relative" style={{ '--tree-guide-left': '14px' } as CSSProperties}>{render('', 1)}</div>}
    </div>
  )
}
