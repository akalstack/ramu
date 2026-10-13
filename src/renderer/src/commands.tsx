import { t, useLanguage } from './i18n'
import { FileIcon } from './FileIcon'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Command, CommandInput, CommandList, CommandItem, CommandEmpty, CommandGroup, CommandShortcut } from '@/components/ui/command'
// Commands, keyboard shortcuts and the command palette.
import { CornerDownLeft, File, FolderTree, MessageSquare, Sparkles, SquareChevronRight } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { fuzzy, highlight } from './fuzzy'
import { notifyError } from './Notifications'
import { errorText } from './TaskPane'
import { useModelSets } from './ModelSets'
import { invoke } from './ipc'
import { titleFrom } from './NewTask'
import { commitAndPush } from './commitShortcut'
import { isPreviewable, isWorkspaceCtx, isWorktreeCtx, tabOrder, type WorkspaceApi } from './workspace'

const isMac = navigator.userAgent.includes('Mac')

/** Shortcut in a portable form: "mod" is ⌘ on macOS and Ctrl elsewhere. */
export interface Command {
  id: string
  title: string
  category: string
  keys?: string
  run: () => void
  when?: () => boolean
}

/** Task-scoped UI actions that live in TaskPane's own state. */
export type TaskAction = 'new-chat'
export function taskAction(taskId: string, action: TaskAction) {
  window.dispatchEvent(new CustomEvent('ramu:task-action', { detail: { taskId, action } }))
}

export interface ShellControls {
  openPalette(mode: PaletteMode): void
  toggleSidebar(): void
  showSearch(): void
  showSidebar?(tab: 'projects' | 'explorer' | 'search' | 'scm'): void
}

export function buildCommands(ws: WorkspaceApi, shell: ShellControls): Command[] {
  const taskId = ws.ui.activeTaskId
  const state = taskId ? ws.taskUi[taskId] : undefined
  const tabs = state ? tabOrder(state.views) : []
  const active = tabs.find((v) => v.id === state?.activeViewId)
  const bindings = taskId ? (ws.bindings[taskId] ?? []).filter((b) => b.setupState === 'ready') : []
  const hasTask = () => !!taskId

  const cycleTab = (delta: number) => {
    const editorTabs = tabs.filter((v) => v.kind === 'file' || v.kind === 'diff' || v.kind === 'git' || v.kind === 'review')
    if (!taskId || !editorTabs.length) return
    const i = editorTabs.findIndex((v) => v.id === active?.id)
    ws.activateView(taskId, editorTabs[(i + delta + editorTabs.length) % editorTabs.length]!.id)
  }
  const cycleTask = (delta: number) => {
    const ids = ws.tasks.filter((task) => task.status !== 'archived').sort((a, b) => b.lastActiveAt - a.lastActiveAt).map((task) => task.id)
    if (!ids.length) return
    const i = ids.indexOf(ws.ui.activeTaskId ?? '')
    ws.openTask(ids[(i + delta + ids.length) % ids.length]!)
  }
  const newTerminal = (repoId?: string) => taskId && ws.openView(taskId, { kind: 'terminal', repoId })
  const toggleTerminal = () => {
    if (!taskId) return
    if (state?.terminalOpen) {
      ws.setTerminalPanel(taskId, { terminalOpen: false })
      return
    }
    const term = [...tabs].reverse().find((v) => v.kind === 'terminal')
    if (term) ws.activateView(taskId, term.id)
    else newTerminal()
  }

  // Bindings follow VS Code's macOS defaults wherever VS Code has an equivalent. Keys Monaco
  // uses inside the editor (⌘L, ⌘K, ⌘.) are left alone so editing behaves as expected.
  const cmds: Command[] = [
    { id: 'palette.commands', title: t("Show all commands"), category: t("View"), keys: 'mod+shift+p', run: () => shell.openPalette('commands') },
    { id: 'palette.files', title: t("Go to file…"), category: t("Go"), keys: 'mod+p', run: () => shell.openPalette('files') },
    { id: 'task.new', title: t("New chat"), category: t("Chat"), keys: 'mod+n', run: () => ws.newTask(), when: () => true },
    { id: 'chat.new', title: t("New chat in this project"), category: t("Chat"), keys: 'ctrl+mod+i', run: () => taskId && ws.newTask(ws.projectOf(taskId)?.id), when: () => !!taskId },
    // ⌘F finds in the visible chat, unless the editor or a terminal has focus and wants its own find.
    { id: 'chat.find', title: t("Find in chat"), category: t("Chat"), keys: 'mod+f', run: () => window.dispatchEvent(new Event('ramu:find-in-chat')), when: () => !document.activeElement?.closest('.monaco-editor, .xterm') && [...document.querySelectorAll('.agent-view')].some((el) => el.checkVisibility()) },
    { id: 'task.next', title: t("Next chat"), category: t("Chat"), run: () => cycleTask(1) },
    { id: 'task.prev', title: t("Previous chat"), category: t("Chat"), run: () => cycleTask(-1) },
    {
      id: 'agent.interrupt',
      title: t("Interrupt agent"),
      category: t("Chat"),
      run: () => active?.kind === 'agent' && void invoke('agent.interrupt', active.sessionId),
      when: () => active?.kind === 'agent',
    },
    { id: 'term.toggle', title: t("Toggle terminal"), category: 'Terminal', keys: 'ctrl+`', run: toggleTerminal, when: hasTask },
    { id: 'term.toggle2', title: t("Toggle panel"), category: t("View"), keys: 'mod+j', run: toggleTerminal, when: hasTask },
    { id: 'term.new', title: t("Create new terminal"), category: 'Terminal', keys: 'ctrl+shift+`', run: () => newTerminal(), when: hasTask },
    ...bindings.map((b) => ({
      id: `term.new.${b.repoId}`,
      title: t("New terminal in {0}", { "0": b.repoName }),
      category: 'Terminal',
      run: () => newTerminal(b.repoId),
    })),
    { id: 'settings.open', title: t("Open settings"), category: t("Preferences"), keys: 'mod+,', run: () => window.dispatchEvent(new Event('ramu:settings')) },
    { id: 'settings.models', title: t("Model sets and reasoning defaults"), category: t("Preferences"), run: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'models' } })) },
    { id: 'file.new', title: t("New file…"), category: 'File', run: () => window.dispatchEvent(new CustomEvent('ramu:create-entry', { detail: { kind: 'file' } })), when: hasTask },
    { id: 'folder.new', title: t("New folder…"), category: 'File', run: () => window.dispatchEvent(new CustomEvent('ramu:create-entry', { detail: { kind: 'dir' } })), when: hasTask },
    { id: 'file.save-all', title: t("Save all files"), category: 'File', keys: 'mod+alt+s', run: () => window.dispatchEvent(new Event('ramu:save-all')), when: hasTask },
    { id: 'tab.reopen', title: t("Reopen closed editor"), category: t("View"), keys: 'mod+shift+t', run: () => taskId && ws.reopenClosedView(taskId), when: hasTask },
    { id: 'tab.keep', title: t("Keep preview editor open"), category: t("View"), run: () => { if (taskId && active) ws.keepView(taskId, active.id) }, when: () => !!active && isPreviewable(active) && !!active.preview },
    { id: 'tab.close-all', title: t("Close all editors"), category: t("View"), run: () => taskId && ws.closeViews(taskId, tabs.filter((tab) => tab.kind !== 'agent' && tab.kind !== 'terminal').map((tab) => tab.id)), when: hasTask },
    ...(['horizontal', 'vertical'] as const).map((direction) => ({ id: `term.split.${direction}`, title: t("Split terminal {0}", { "0": direction === 'horizontal' ? 'side by side' : 'stacked' }), category: 'Terminal', run: () => { if (taskId) { ws.splitTerminal(taskId, direction) } }, when: hasTask })),
    ...(['right', 'bottom'] as const).map((dock) => ({ id: `term.dock.${dock}`, title: t(dock === 'right' ? "Dock terminal on right" : "Dock terminal at bottom"), category: 'Terminal', run: () => taskId && ws.setTerminalPanel(taskId, { terminalDock: dock }), when: hasTask })),
    ...(['top', 'right'] as const).map((position) => ({ id: `term.tabs.${position}`, title: t("Show terminal tabs on {0}", { "0": position }), category: 'Terminal', run: () => taskId && ws.setTerminalPanel(taskId, { terminalTabPosition: position }), when: hasTask })),
    ...bindings.filter((binding) => !binding.folderOnly).flatMap((binding) => {
      const action = async (kind: 'sync' | 'fetch' | 'pull' | 'push' | 'stage' | 'unstage') => {
        if (!taskId) return
        if ((kind === 'pull' || kind === 'sync') && Object.values(ws.dirty).some(Boolean)) throw new Error('Save or close unsaved files before pulling.')
        if (kind === 'stage' || kind === 'unstage') {
          const status = await invoke('git.status', taskId, binding.repoId)
          const paths = status.entries.filter((entry) => kind === 'stage' ? !!entry.unstaged && entry.unstaged !== 'unmerged' : !!entry.staged && entry.staged !== 'unmerged').map((entry) => entry.path)
          await invoke(kind === 'stage' ? 'git.stage' : 'git.unstage', taskId, binding.repoId, paths)
        } else await invoke(kind === 'sync' ? 'git.sync' : kind === 'fetch' ? 'git.fetch' : kind === 'pull' ? 'git.pull' : 'git.push', taskId, binding.repoId)
        window.dispatchEvent(new Event('ramu:git-updated'))
      }
      return (['sync', 'fetch', 'pull', 'push', 'stage', 'unstage'] as const).map((kind) => ({ id: `git.${kind}.${binding.repoId}`, title: `${kind === 'stage' ? 'Stage all changes' : kind === 'unstage' ? 'Unstage all changes' : kind[0]!.toUpperCase() + kind.slice(1)} · ${binding.repoName}`, category: 'Git', run: () => { void action(kind).catch((reason) => notifyError(errorText(reason), `Git · ${binding.repoName}`)) } }))
    }),
    { id: 'tab.close', title: t("Close editor"), category: t("View"), keys: 'mod+w', run: () => taskId && active && ws.closeView(taskId, active.id), when: () => !!active },
    { id: 'tab.next', title: t("Open next editor"), category: t("View"), keys: 'ctrl+tab', run: () => cycleTab(1), when: hasTask },
    { id: 'tab.prev', title: t("Open previous editor"), category: t("View"), keys: 'ctrl+shift+tab', run: () => cycleTab(-1), when: hasTask },
    { id: 'tab.next2', title: t("Open next editor"), category: t("View"), keys: 'mod+alt+right', run: () => cycleTab(1), when: hasTask },
    { id: 'tab.prev2', title: t("Open previous editor"), category: t("View"), keys: 'mod+alt+left', run: () => cycleTab(-1), when: hasTask },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `tab.go${i + 1}`,
      title: t("Open editor {0}", { "0": i + 1 }),
      category: t("View"),
      keys: `ctrl+${i + 1}`,
      run: () => {
        const fileTabs = tabs.filter((v) => v.kind === 'file' || v.kind === 'diff' || v.kind === 'git' || v.kind === 'review')
        const t = i === 8 ? fileTabs.at(-1) : fileTabs[i]
        if (taskId && t) ws.activateView(taskId, t.id)
      },
      when: () => tabs.filter((v) => v.kind === 'file' || v.kind === 'diff' || v.kind === 'git' || v.kind === 'review').length > i,
    })),
    { id: 'view.sidebar', title: t("Toggle primary side bar"), category: t("View"), keys: 'mod+b', run: shell.toggleSidebar },
    { id: 'view.right-panel', title: t("Toggle right panel"), category: t("View"), keys: 'mod+alt+b', run: () => taskId && ws.toggleRightPanel(taskId), when: hasTask },
    { id: 'view.chats', title: t("Show chats"), category: t("View"), run: () => shell.showSidebar ? shell.showSidebar('projects') : ws.setSidebar('projects') },
    { id: 'view.explorer', title: t("Show explorer"), category: t("View"), keys: 'mod+shift+e', run: () => shell.showSidebar ? shell.showSidebar('explorer') : ws.setSidebar('explorer') },
    { id: 'view.search', title: t("Search in project"), category: t("View"), keys: 'mod+shift+f', run: shell.showSearch },
    { id: 'git.commit-push', title: t("Commit & Push"), category: t("Source Control"), keys: 'mod+alt+p', run: () => taskId && commitAndPush(ws, taskId), when: hasTask },
    { id: 'view.scm', title: t("Show source control"), category: t("View"), keys: 'ctrl+shift+g', run: () => shell.showSidebar ? shell.showSidebar('scm') : ws.setSidebar('scm') },
  ]
  return cmds
}

/** Matches a keydown against "mod+shift+p"-style bindings. */
function matches(e: KeyboardEvent, keys: string): boolean {
  const parts = keys.split('+')
  const key = parts.pop()!
  const want = new Set(parts)
  const ctrlWanted = want.has('ctrl') || (!isMac && want.has('mod'))
  const metaWanted = isMac && want.has('mod')
  if (e.ctrlKey !== ctrlWanted || e.metaKey !== metaWanted) return false
  if (want.has('shift') !== e.shiftKey) return false
  if (want.has('alt') !== e.altKey) return false
  const named: Record<string, string> = { right: 'ArrowRight', left: 'ArrowLeft', tab: 'Tab' }
  if (named[key]) return e.key === named[key]
  // Use the physical key for symbols so shift and keyboard layouts don't change the binding.
  const code: Record<string, string> = { '`': 'Backquote', '[': 'BracketLeft', ']': 'BracketRight', '.': 'Period' }
  if (code[key]) return e.code === code[key]
  if (/^\d$/.test(key)) return e.code === `Digit${key}`
  // With ⌥ held, macOS changes e.key (⌥B → ∫), so match the physical letter.
  if (want.has('alt') && /^[a-z]$/.test(key)) return e.code === `Key${key.toUpperCase()}`
  return e.key.toLowerCase() === key
}

/** Global shortcuts. Capture phase, so they win over Monaco and the terminal. */
export function useKeybindings(commands: Command[], enabled: boolean) {
  const language = useLanguage()

  const ref = useRef(commands)
  ref.current = commands
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      // Toasts are (alert)dialogs too, but a visible notification must not switch shortcuts off.
      if (document.querySelector(':is([role="dialog"], [role="alertdialog"]):not([data-slot="toast"]), [role="menu"], [role="listbox"], .menu')) return
      for (const c of ref.current) {
        if (c.keys && matches(e, c.keys) && (!c.when || c.when())) {
          e.preventDefault()
          e.stopPropagation()
          void Promise.resolve().then(c.run).catch((reason) => notifyError(errorText(reason), c.category))
          return
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}

export function formatKeys(keys: string): string {
  const sym: Record<string, string> = isMac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃', right: '→', left: '←', tab: '⇥', enter: '↩' }
    : { mod: 'Ctrl+', shift: 'Shift+', alt: 'Alt+', ctrl: 'Ctrl+', right: '→', left: '←', tab: 'Tab', enter: 'Enter' }
  return keys
    .split('+')
    .map((k) => sym[k] ?? k.toUpperCase())
    .join('')
}

export type PaletteMode = 'commands' | 'files'

interface Item {
  key: string
  icon: ReactNode
  label: string
  detail?: string
  hits?: number[]
  keys?: string
  group: string
  run: () => void
}

/**
 * One box for everything. No prefix: files in the task's repositories, tasks and conversations.
 * ">" runs commands. Anything else can be sent straight to the agent.
 */
export function Palette({ ws, commands, mode, onClose }: { ws: WorkspaceApi; commands: Command[]; mode: PaletteMode; onClose: () => void }) {
  const language = useLanguage()

  const { initialSettings } = useModelSets()
  const [query, setQuery] = useState(mode === 'commands' ? '>' : '')
  const [files, setFiles] = useState<{ repoId: string; path: string }[]>([])
  const [recent, setRecent] = useState<string[]>(() => { try { const value = JSON.parse(localStorage.getItem('ramu.recent-commands') ?? '[]'); return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string').slice(0, 20) : [] } catch { return [] } })
  const [sel, setSel] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const taskId = ws.ui.activeTaskId

  useEffect(() => {
    let disposed = false
    setFiles([])
    if (taskId) void invoke('files.all', taskId).then((value) => { if (!disposed) setFiles(value) }, (reason) => { if (!disposed) notifyError(errorText(reason), 'Quick Open') })
    return () => { disposed = true }
  }, [taskId])

  const items = useMemo<Item[]>(() => {
    const isCommand = query.startsWith('>')
    const q = isCommand ? query.slice(1).trim() : query.trim()
    const ranked: (Item & { score: number })[] = []
    if (isCommand) {
      const seen = new Set<string>()
      for (const c of commands) {
        if ((c.when && !c.when()) || seen.has(c.title)) continue
        seen.add(c.title)
        const m = fuzzy(q, `${c.category}: ${c.title}`)
        if (m) ranked.push({ key: c.id, icon: <SquareChevronRight size={14} />, label: `${c.category}: ${c.title}`, hits: m.hits, keys: c.keys, group: 'Commands', run: c.run, score: m.score + (!q && recent.includes(c.id) ? 1000 - recent.indexOf(c.id) : 0) })
      }
      return ranked.sort((a, b) => b.score - a.score).slice(0, 80)
    }
    const location = /:(\d+)(?::(\d+))?$/.exec(q)
    const fileQuery = location ? q.slice(0, location.index) : q
    const repoName = (repoId: string) => (taskId ? ws.binding(taskId, repoId)?.repoName : undefined) ?? ''
    const multiRepo = taskId ? (ws.bindings[taskId] ?? []).length > 1 : false
    for (const f of files) {
      const m = fuzzy(fileQuery, f.path)
      if (m) {
        ranked.push({
          key: `f:${f.repoId}:${f.path}`,
          icon: <FileIcon path={f.path} />,
          label: f.path,
          hits: m.hits,
          detail: multiRepo ? repoName(f.repoId) : undefined,
          group: 'Files',
          run: () => taskId && ws.openView(taskId, { kind: 'file', repoId: f.repoId, path: f.path, preview: false, ...(location ? { selection: { line: Math.max(1, Math.min(Number(location[1]), 1_000_000)), column: Math.max(1, Math.min(Number(location[2] ?? 1), 1_000_000)), endColumn: Math.max(1, Math.min(Number(location[2] ?? 1), 1_000_000)), requestId: crypto.randomUUID() } } : {}) }),
          score: m.score,
        })
      }
    }
    const out = ranked.sort((a, b) => b.score - a.score).slice(0, q ? 40 : 12) as Item[]
    for (const project of ws.projects) {
      const match = fuzzy(q, `${project.name} ${project.root ?? ''}`)
      if (q && match) out.push({ key: `project:${project.id}`, icon: <FolderTree size={14} />, label: project.name, detail: project.root ?? undefined, group: 'Projects', run: () => ws.openProject(project.id) })
    }
    for (const t of ws.tasks.filter((task) => task.status !== 'archived')) {
      const m = fuzzy(q, t.title)
      if (m && q) out.push({ key: `t:${t.id}`, icon: <FolderTree size={14} />, label: t.title, hits: m.hits, detail: ws.projects.find((p) => p.id === t.projectId)?.name, group: 'Chats', run: () => ws.openTask(t.id) })
    }
    if (q && taskId) {
      // Send what you typed to the agent: the open conversation if there is one, else a new chat.
      const state = ws.taskUi[taskId]
      const chat = state?.views.find((v) => v.id === state.activeAgentViewId && v.kind === 'agent')
      out.push({
        key: 'ask',
        icon: <Sparkles size={14} />,
        label: q,
        detail: chat ? t("Send to the agent") : t("Start a chat with the agent"),
        group: 'Agent',
        run: async () => {
          if (chat?.kind === 'agent') {
            await invoke('agent.send', chat.sessionId, q)
            ws.activateView(taskId, chat.id)
          } else if (isWorkspaceCtx(taskId)) {
            // From a project's workspace view, a message starts a new chat (task) in that project.
            const task = await invoke('tasks.create', { projectId: ws.projectOf(taskId)!.id, title: titleFrom(q), mode: isWorktreeCtx(taskId) ? 'worktree' : 'current', workspaceId: isWorktreeCtx(taskId) ? taskId.slice('worktree:'.length) : undefined })
            await ws.refresh()
            ws.openTask(task.id)
            const s = await invoke('agent.start', task.id, q, initialSettings)
            ws.openView(task.id, { kind: 'agent', sessionId: s.id })
          } else {
            const s = await invoke('agent.start', taskId, q, initialSettings)
            ws.openView(taskId, { kind: 'agent', sessionId: s.id })
          }
        },
      })
    }
    return out
  }, [query, files, commands, ws, taskId, recent, initialSettings, language])

  useEffect(() => setSel(0), [query])
  useEffect(() => setSel((current) => Math.max(0, Math.min(current, items.length - 1))), [items.length])
  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const choose = (item: Item | undefined) => {
    if (!item) return
    if (item.group === 'Commands') { const next = [item.key, ...recent.filter((key) => key !== item.key)].slice(0, 20); setRecent(next); try { localStorage.setItem('ramu.recent-commands', JSON.stringify(next)) } catch { /* Session history remains available. */ } }
    onClose()
    void Promise.resolve().then(item.run).catch((reason) => notifyError(errorText(reason), 'Command palette'))
  }

  // The shadcn Command pieces do the layout; items are grouped in the order they were ranked.
  const groups: { name: string; items: { item: Item; index: number }[] }[] = []
  items.forEach((item, index) => { const group = groups.find((entry) => entry.name === item.group) ?? (groups.push({ name: item.group, items: [] }), groups.at(-1)!); group.items.push({ item, index }) })
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}><DialogContent className="palette [[data-slot='dialog-content']&]:block [[data-slot='dialog-content']&]:p-0 [[data-slot='dialog-content']&]:max-w-[none] [[data-slot='dialog-content']&]:gap-0 [[data-slot='dialog-content']&]:w-[min(640px,_calc(100vw_-_48px))] [[data-slot='dialog-content']&]:top-[12vh]! [[data-slot='dialog-content']&]:[translate:-50%_0]! [background:var(--float-bg)] [-webkit-backdrop-filter:var(--float-blur)] [backdrop-filter:var(--float-blur)] [border:1px_solid_var(--edge)] [box-shadow:0_18px_48px_rgba(0,_0,_0,_0.45),_0_2px_8px_rgba(0,_0,_0,_0.25),_inset_0_1px_0_rgba(255,_255,_255,_0.07)] [&_[data-slot='command']]:p-1.5 [&_[data-slot='command-input-wrapper']]:p-[2px_2px_6px] [&_[data-slot='command-input']]:text-chat [&_[data-slot='command-input']]:[border:0] [&_[data-slot='command-input']]:[box-shadow:none] [&_[data-slot='command-input']]:[outline:0] [&_[data-slot='command-input']]:bg-transparent [&_[data-slot='command-input']]:p-0 [&_[data-slot='command-input']]:min-h-0 [&_[data-slot='command-input']]:h-full [&_[data-slot='command-item']]:gap-2.5 [&_[data-slot='command-item']]:min-h-8 [&_[data-slot='command-item']]:pt-1 [&_[data-slot='command-item']]:pb-1 [&_[data-slot='command-item']]:rounded-(--radius-s) [&_[data-slot='command-item'][data-selected='true']]:bg-accent [&_[data-slot='command-item'][data-selected='true']]:text-foreground [&_.palette-icon]:flex [&_.palette-icon]:flex-none [&_.palette-icon]:text-muted-foreground [&_[data-slot='command-item'][data-selected='true']_.palette-icon]:text-brand [&_.palette-label]:flex-1 [&_.palette-label]:min-w-0 [&_.palette-label]:overflow-hidden [&_.palette-label]:text-ellipsis [&_.palette-label]:whitespace-nowrap [&_.palette-label_mark]:bg-transparent [&_.palette-label_mark]:text-brand [&_.palette-label_mark]:font-semibold [&_[data-slot='command-shortcut']]:ml-auto [&_[data-slot='command-shortcut']]:pl-3 [&_[data-slot='command-shortcut']]:whitespace-nowrap [&_[data-slot='command-shortcut']]:text-caption [&_[data-slot='command-shortcut']]:tracking-[0] [&_[data-slot='command-input']:focus]:[border:0] [&_[data-slot='command-input']:focus]:[box-shadow:none] [&_[data-slot='command-input']:focus]:[outline:0] [&_[data-slot='command-input']:focus]:bg-transparent [&_[data-slot='command-input']:focus]:p-0 [&_[data-slot='command-input']:focus]:min-h-0 [&_[data-slot='command-input']:focus]:h-full [&_[data-slot='command-input']:focus-visible]:[border:0] [&_[data-slot='command-input']:focus-visible]:[box-shadow:none] [&_[data-slot='command-input']:focus-visible]:[outline:0] [&_[data-slot='command-input']:focus-visible]:bg-transparent [&_[data-slot='command-input']:focus-visible]:p-0 [&_[data-slot='command-input']:focus-visible]:min-h-0 [&_[data-slot='command-input']:focus-visible]:h-full [&_[data-slot='command-input-wrapper']_[data-slot='input-group-addon']]:pl-[9px]! [&_[data-slot='command-input-wrapper']_[data-slot='input-group-addon']]:pr-0 [&_[data-slot='command-input-wrapper']_[data-slot='command-input']]:pl-2.5 w-[min(640px,_calc(100vw_-_48px))] bg-card [border:1px_solid_var(--edge)] [box-shadow:0_24px_64px_rgba(0,_0,_0,_0.55)] overflow-hidden [animation:pop_0.14s_var(--ease)] rounded-(--radius-l)" showCloseButton={false} aria-describedby={undefined}><DialogTitle className="sr-only">{t("Command palette")}</DialogTitle>
      <Command shouldFilter={false} value={items[sel]?.key ?? ''} onValueChange={(value) => { const index = items.findIndex((it) => it.key === value); if (index >= 0) setSel(index) }}>
        <CommandInput autoFocus aria-label={t("Search files and commands")} value={query} placeholder={taskId ? t("Search files, chats, or projects. Type > for commands") : t("Type > for commands")} onValueChange={setQuery} onKeyDown={(e) => { if (e.key === 'Escape') onClose() }} />
        <CommandList id="palette-options" ref={list} className="max-h-[min(440px,calc(100vh-180px))]">
          <CommandEmpty>{t("No matches")}</CommandEmpty>
          {groups.map((group) => <CommandGroup key={group.name} heading={t(group.name)}>
            {group.items.map(({ item: it, index: i }) => <CommandItem key={it.key} value={it.key} id={`palette-option-${i}`} onSelect={() => choose(it)}>
              <span className="palette-icon text-muted-foreground flex flex-none">{it.icon}</span>
              <span className="palette-label [&_mark]:bg-transparent [&_mark]:text-brand [&_mark]:font-semibold flex-1 min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{it.hits ? highlight(it.label, it.hits).map((r, j) => (r.hit ? <mark key={j}>{r.text}</mark> : <span key={j}>{r.text}</span>)) : it.label}</span>
              {it.keys ? <CommandShortcut>{formatKeys(it.keys)}</CommandShortcut> : it.detail ? <CommandShortcut className="palette-detail text-caption text-muted-foreground whitespace-nowrap">{it.detail}</CommandShortcut> : null}
            </CommandItem>)}
          </CommandGroup>)}
        </CommandList>
      </Command>
    </DialogContent></Dialog>
  )
}
