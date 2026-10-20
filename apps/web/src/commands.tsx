import { SETTINGS_SECTIONS } from './settings/SettingsPage'
import { t, useLanguage } from './i18n'
// Commands and keyboard shortcuts. The command palette lives in palette/.
import { useEffect, useRef } from 'react'
import { notifyError } from './chat/Notifications'
import { errorText } from './workspace/TaskPane'
import type { RamuBridge } from '@ramu/shared/api'
import { invoke } from './ipc'
import { withGitBusy } from './git/gitBusy'
import { commitAndPush } from './git/commitShortcut'
import type { PaletteMode } from './palette/sources'
import { isPreviewable, tabOrder, type WorkspaceApi } from './workspace/workspace'
import { terminalGroups } from '@ramu/shared/workspace/terminalGroups'

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
export type TaskAction = 'new-chat' | 'toggle-chat'
export function taskAction(taskId: string, action: TaskAction) {
  window.dispatchEvent(new CustomEvent('ramu:task-action', { detail: { taskId, action } }))
}

export interface ShellControls {
  defaultTerminalDock?: 'right' | 'bottom'
  openPalette(mode: PaletteMode): void
  toggleSidebar(): void
  showSearch(): void
  showSidebar?(tab: 'projects' | 'explorer' | 'search' | 'scm' | 'schedules' | 'inbox'): void
  createSchedule(): void
  addProject?(): void
  /** The bound `invoke` of the host on screen (`useHost().invoke`); thread and Git commands run there. */
  invoke?: RamuBridge['invoke']
}

export function buildCommands(ws: WorkspaceApi, shell: ShellControls): Command[] {
  const hostInvoke = shell.invoke ?? invoke
  const taskId = ws.ui.activeTaskId
  const state = taskId ? ws.taskUi[taskId] : undefined
  const terminalDock = state?.terminalDock ?? shell.defaultTerminalDock ?? 'bottom'
  const tabs = state ? tabOrder(state.views) : []
  const active = tabs.find((v) => v.id === state?.activeViewId)
  const groups = state ? terminalGroups(state) : []
  const workspaceTabs = tabs.filter(
    (view) =>
      view.kind !== 'agent' &&
      (view.kind !== 'terminal' ||
        ((state?.terminalDock ?? shell.defaultTerminalDock ?? 'bottom') === 'right' &&
          state?.terminalOpen !== false &&
          groups.some((group) => group.terminalIds[0] === view.id))),
  )
  const bindings = taskId ? (ws.bindings[taskId] ?? []).filter((b) => b.setupState === 'ready') : []
  const hasTask = () => !!taskId
  const chat =
    active?.kind === 'agent'
      ? active
      : (tabs.find((view) => view.kind === 'agent' && view.id === state?.activeAgentViewId) ??
        tabs.findLast((view) => view.kind === 'agent'))
  const hasVisibleChat = () =>
    [...document.querySelectorAll('.agent-view[data-chat-visible]')].some((el) => el.checkVisibility())

  const cycleTab = (delta: number) => {
    const editorTabs = workspaceTabs
    if (!taskId || !editorTabs.length) return
    const activeGroup = groups.find((group) => group.terminalIds.includes(active?.id ?? ''))
    const i = editorTabs.findIndex((v) => v.id === active?.id || v.id === activeGroup?.terminalIds[0])
    ws.activateView(taskId, editorTabs[(i + delta + editorTabs.length) % editorTabs.length]!.id)
  }
  const cycleTask = (delta: number) => {
    const ids = ws.tasks
      .filter((task) => task.status !== 'archived')
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
      .map((task) => task.id)
    if (!ids.length) return
    const i = ids.indexOf(ws.ui.activeTaskId ?? '')
    ws.openTask(ids[(i + delta + ids.length) % ids.length]!)
  }
  const newTerminal = (repoId?: string) => taskId && ws.openView(taskId, { kind: 'terminal', repoId })
  const toggleTerminal = () => {
    if (!taskId) return
    if (terminalDock === 'bottom' && state?.views.some((v) => v.kind === 'terminal') && state.terminalOpen !== false) {
      ws.setTerminalPanel(taskId, { terminalOpen: false })
      return
    }
    const term =
      tabs.find((v) => v.kind === 'terminal' && v.id === state?.activeTerminalId) ??
      [...tabs].reverse().find((v) => v.kind === 'terminal')
    if (term) ws.activateView(taskId, term.id)
    else newTerminal()
  }

  // Bindings follow VS Code's macOS defaults wherever VS Code has an equivalent. Keys Monaco
  // uses inside the editor (⌘L, ⌘K, ⌘.) are left alone so editing behaves as expected.
  const cmds: Command[] = [
    {
      id: 'palette.commands',
      title: t('Show all commands'),
      category: t('View'),
      keys: 'mod+shift+p',
      run: () => shell.openPalette('commands'),
    },
    {
      id: 'palette.files',
      title: t('Go to file…'),
      category: t('Go'),
      keys: 'mod+p',
      run: () => shell.openPalette('files'),
    },
    { id: 'schedule.new', title: t('New schedule'), category: t('Schedules'), run: shell.createSchedule },
    ...(shell.addProject
      ? [{ id: 'project.add', title: t('Add project…'), category: t('Project'), run: shell.addProject }]
      : []),
    {
      id: 'task.new',
      title: t('New thread'),
      category: t('Thread'),
      keys: 'mod+n',
      run: () => ws.newTask(),
      when: () => true,
    },
    {
      id: 'chat.new',
      title: t('New thread in this project'),
      category: t('Thread'),
      keys: 'ctrl+mod+i',
      run: () => taskId && ws.newTask(ws.projectOf(taskId)?.id),
      when: () => !!taskId,
    },
    // ⌘F finds in the visible chat, unless the editor or a terminal has focus and wants its own find.
    {
      id: 'chat.find',
      title: t('Find in thread'),
      category: t('Thread'),
      keys: 'mod+f',
      run: () => window.dispatchEvent(new Event('ramu:find-in-chat')),
      when: () =>
        !document.activeElement?.closest('.monaco-editor, .xterm, .md-preview-pane') &&
        [...document.querySelectorAll('.agent-view')].some((el) => el.checkVisibility()),
    },
    { id: 'task.next', title: t('Next thread'), category: t('Thread'), run: () => cycleTask(1) },
    { id: 'task.prev', title: t('Previous thread'), category: t('Thread'), run: () => cycleTask(-1) },
    {
      id: 'agent.interrupt',
      title: t('Interrupt agent'),
      category: t('Thread'),
      run: async () => {
        if (chat?.kind === 'agent') await hostInvoke('agent.interrupt', chat.sessionId)
      },
      when: () => chat?.kind === 'agent' && hasVisibleChat(),
    },
    {
      id: 'chat.aside',
      title: t('Toggle aside'),
      category: t('Thread'),
      keys: 'mod+shift+a',
      run: () => window.dispatchEvent(new CustomEvent('ramu:chat-panel', { detail: { panel: 'aside' } })),
      when: () => hasVisibleChat() && !window.getSelection()?.toString().trim(),
    },
    {
      id: 'chat.agents',
      title: t('Show agents'),
      category: t('Thread'),
      run: () => window.dispatchEvent(new CustomEvent('ramu:chat-panel', { detail: { panel: 'agents' } })),
      when: () =>
        [...document.querySelectorAll('.agent-view[data-chat-visible] .agents-chip[aria-pressed]')].some((el) =>
          el.checkVisibility(),
        ),
    },
    {
      id: 'term.toggle',
      title: terminalDock === 'right' ? t('Show terminal') : t('Toggle terminal'),
      category: 'Terminal',
      keys: 'ctrl+`',
      run: toggleTerminal,
      when: hasTask,
    },
    {
      id: 'term.toggle2',
      title: terminalDock === 'right' ? t('Show terminal') : t('Toggle panel'),
      category: t('View'),
      keys: 'mod+j',
      run: toggleTerminal,
      when: hasTask,
    },
    {
      id: 'term.new',
      title: t('Create new terminal'),
      category: 'Terminal',
      keys: 'ctrl+shift+`',
      run: () => newTerminal(),
      when: hasTask,
    },
    ...bindings.map((b) => ({
      id: `term.new.${b.repoId}`,
      title: t('New terminal in {0}', { '0': b.repoName }),
      category: 'Terminal',
      run: () => newTerminal(b.repoId),
    })),
    {
      id: 'settings.open',
      title: t('Open settings'),
      category: t('Preferences'),
      keys: 'mod+,',
      run: () => window.dispatchEvent(new Event('ramu:settings')),
    },
    {
      id: 'updates.check',
      title: t('Check for updates'),
      category: t('Preferences'),
      run: async () => {
        window.dispatchEvent(
          new CustomEvent('ramu:settings', { detail: { section: 'system', target: 'Check app updates' } }),
        )
        await invoke('updates.check')
      },
    },
    {
      id: 'settings.models',
      title: t('Model sets and reasoning defaults'),
      category: t('Preferences'),
      run: () =>
        window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: 'models', target: 'Model sets' } })),
    },
    ...SETTINGS_SECTIONS.map((section) => ({
      id: `settings.${section.id}`,
      title: t('Open {0} settings', { '0': t(section.label) }),
      category: t('Preferences'),
      run: () => window.dispatchEvent(new CustomEvent('ramu:settings', { detail: { section: section.id } })),
    })),
    {
      id: 'file.new',
      title: t('New file…'),
      category: 'File',
      run: () => window.dispatchEvent(new CustomEvent('ramu:create-entry', { detail: { kind: 'file' } })),
      when: hasTask,
    },
    {
      id: 'folder.new',
      title: t('New folder…'),
      category: 'File',
      run: () => window.dispatchEvent(new CustomEvent('ramu:create-entry', { detail: { kind: 'dir' } })),
      when: hasTask,
    },
    {
      id: 'file.save-all',
      title: t('Save all files'),
      category: 'File',
      keys: 'mod+alt+s',
      run: () => window.dispatchEvent(new Event('ramu:save-all')),
      when: hasTask,
    },
    {
      id: 'tab.reopen',
      title: t('Reopen closed editor'),
      category: t('View'),
      keys: 'mod+shift+t',
      run: () => taskId && ws.reopenClosedView(taskId),
      when: hasTask,
    },
    {
      id: 'tab.keep',
      title: t('Keep preview editor open'),
      category: t('View'),
      run: () => {
        if (taskId && active) ws.keepView(taskId, active.id)
      },
      when: () => !!active && isPreviewable(active) && !!active.preview,
    },
    {
      id: 'tab.close-all',
      title: t('Close all editors'),
      category: t('View'),
      run: () =>
        taskId &&
        ws.closeViews(
          taskId,
          tabs.filter((tab) => tab.kind !== 'agent' && tab.kind !== 'terminal').map((tab) => tab.id),
        ),
      when: hasTask,
    },
    ...(['horizontal', 'vertical'] as const).map((direction) => ({
      id: `term.split.${direction}`,
      title: t('Split terminal {0}', { '0': direction === 'horizontal' ? 'side by side' : 'stacked' }),
      category: 'Terminal',
      run: () => {
        if (taskId) {
          ws.splitTerminal(taskId, direction)
        }
      },
      when: hasTask,
    })),
    ...(['right', 'bottom'] as const).map((dock) => ({
      id: `term.dock.${dock}`,
      title: t(dock === 'right' ? 'Dock terminal on right' : 'Dock terminal at bottom'),
      category: 'Terminal',
      run: () => taskId && ws.setTerminalPanel(taskId, { terminalDock: dock }),
      when: hasTask,
    })),
    ...(['top', 'right'] as const).map((position) => ({
      id: `term.tabs.${position}`,
      title: t('Show terminal tabs on {0}', { '0': position }),
      category: 'Terminal',
      run: () => taskId && ws.setTerminalPanel(taskId, { terminalTabPosition: position }),
      when: hasTask,
    })),
    ...bindings
      .filter((binding) => !binding.folderOnly)
      .flatMap((binding) => {
        const action = async (kind: 'sync' | 'fetch' | 'pull' | 'push' | 'stage' | 'unstage') => {
          if (!taskId) return
          if ((kind === 'pull' || kind === 'sync') && Object.values(ws.dirty).some(Boolean))
            throw new Error('Save or close unsaved files before pulling.')
          if (kind === 'stage' || kind === 'unstage') {
            const status = await hostInvoke('git.status', taskId, binding.repoId)
            const paths = status.entries
              .filter((entry) =>
                kind === 'stage'
                  ? !!entry.unstaged && entry.unstaged !== 'unmerged'
                  : !!entry.staged && entry.staged !== 'unmerged',
              )
              .map((entry) => entry.path)
            await hostInvoke(kind === 'stage' ? 'git.stage' : 'git.unstage', taskId, binding.repoId, paths)
          } else
            await hostInvoke(
              kind === 'sync' ? 'git.sync' : kind === 'fetch' ? 'git.fetch' : kind === 'pull' ? 'git.pull' : 'git.push',
              taskId,
              binding.repoId,
            )
          window.dispatchEvent(new Event('ramu:git-updated'))
        }
        return (['sync', 'fetch', 'pull', 'push', 'stage', 'unstage'] as const).map((kind) => ({
          id: `git.${kind}.${binding.repoId}`,
          title: `${kind === 'stage' ? 'Stage all changes' : kind === 'unstage' ? 'Unstage all changes' : kind[0]!.toUpperCase() + kind.slice(1)} · ${binding.repoName}`,
          category: 'Git',
          run: () => {
            void withGitBusy(taskId!, binding.repoId, () => action(kind)).catch((reason) =>
              notifyError(errorText(reason), `Git · ${binding.repoName}`),
            )
          },
        }))
      }),
    {
      id: 'tab.close',
      title: t('Close editor'),
      category: t('View'),
      keys: 'mod+w',
      run: () => {
        if (!taskId || !active) return
        const group = active.kind === 'terminal' && groups.find((group) => group.terminalIds.includes(active.id))
        if (group) ws.closeViews(taskId, group.terminalIds)
        else ws.closeView(taskId, active.id)
      },
      when: () => !!active,
    },
    {
      id: 'tab.next',
      title: t('Open next editor'),
      category: t('View'),
      keys: 'ctrl+tab',
      run: () => cycleTab(1),
      when: hasTask,
    },
    {
      id: 'tab.prev',
      title: t('Open previous editor'),
      category: t('View'),
      keys: 'ctrl+shift+tab',
      run: () => cycleTab(-1),
      when: hasTask,
    },
    {
      id: 'tab.next2',
      title: t('Open next editor'),
      category: t('View'),
      keys: 'mod+alt+right',
      run: () => cycleTab(1),
      when: hasTask,
    },
    {
      id: 'tab.prev2',
      title: t('Open previous editor'),
      category: t('View'),
      keys: 'mod+alt+left',
      run: () => cycleTab(-1),
      when: hasTask,
    },
    ...Array.from({ length: 9 }, (_, i) => ({
      id: `tab.go${i + 1}`,
      title: t('Open editor {0}', { '0': i + 1 }),
      category: t('View'),
      keys: `ctrl+${i + 1}`,
      run: () => {
        const fileTabs = workspaceTabs
        const t = i === 8 ? fileTabs.at(-1) : fileTabs[i]
        if (taskId && t) ws.activateView(taskId, t.id)
      },
      when: () => workspaceTabs.length > i,
    })),
    {
      id: 'view.sidebar',
      title: t('Toggle primary side bar'),
      category: t('View'),
      keys: 'mod+b',
      run: shell.toggleSidebar,
    },
    {
      id: 'view.chat',
      title: t('Toggle thread pane'),
      category: t('View'),
      keys: 'mod+alt+c',
      run: () => taskId && taskAction(taskId, 'toggle-chat'),
      when: hasTask,
    },
    {
      id: 'view.right-panel',
      title: t('Toggle workspace'),
      category: t('View'),
      keys: 'mod+alt+b',
      run: () => taskId && ws.toggleRightPanel(taskId),
      when: hasTask,
    },
    {
      id: 'view.home',
      title: t('Show home'),
      category: t('View'),
      run: () => {
        shell.showSidebar?.('projects')
        ws.showHome()
      },
    },
    {
      id: 'view.inbox',
      title: t('Show inbox'),
      category: t('View'),
      keys: 'mod+shift+i',
      run: () => (shell.showSidebar ? shell.showSidebar('inbox') : ws.setSidebar('inbox')),
    },
    {
      id: 'view.schedules',
      title: t('Show schedules'),
      category: t('View'),
      run: () => (shell.showSidebar ? shell.showSidebar('schedules') : ws.setSidebar('schedules')),
    },
    {
      id: 'view.chats',
      title: t('Show threads'),
      category: t('View'),
      run: () => (shell.showSidebar ? shell.showSidebar('projects') : ws.setSidebar('projects')),
    },
    {
      id: 'view.explorer',
      title: t('Show explorer'),
      category: t('View'),
      keys: 'mod+shift+e',
      run: () => (shell.showSidebar ? shell.showSidebar('explorer') : ws.setSidebar('explorer')),
    },
    {
      id: 'view.search',
      title: t('Search in project'),
      category: t('View'),
      keys: 'mod+shift+f',
      run: shell.showSearch,
    },
    {
      id: 'git.commit-push',
      title: t('Commit & Push'),
      category: t('Source Control'),
      keys: 'mod+alt+p',
      run: () => taskId && commitAndPush(ws, taskId),
      when: hasTask,
    },
    {
      id: 'app.reload-window',
      title: t('Reload window'),
      category: t('Application'),
      run: () => window.location.reload(),
    },
    {
      id: 'app.restart',
      title: t('Restart Ramu'),
      category: t('Application'),
      run: () => void invoke('app.relaunch').catch((e) => notifyError(errorText(e), t('Restart Ramu'))),
    },
    {
      id: 'app.restart-service',
      title: t('Restart Ramu and the background service'),
      category: t('Application'),
      run: () => void invoke('background.restart').catch((e) => notifyError(errorText(e), t('Restart service'))),
    },
    {
      id: 'view.scm',
      title: t('Show source control'),
      category: t('View'),
      keys: 'ctrl+shift+g',
      run: () => (shell.showSidebar ? shell.showSidebar('scm') : ws.setSidebar('scm')),
    },
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
  useLanguage()

  const ref = useRef(commands)
  ref.current = commands
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      // Toasts are (alert)dialogs too, but a visible notification must not switch shortcuts off.
      if (
        document.querySelector(
          ':is([role="dialog"], [role="alertdialog"]):not([data-slot="toast"]), [role="menu"], [role="listbox"], .menu',
        )
      )
        return
      for (const c of ref.current) {
        if (c.keys && matches(e, c.keys) && (!c.when || c.when())) {
          e.preventDefault()
          e.stopPropagation()
          void Promise.resolve()
            .then(c.run)
            .catch((reason) => notifyError(errorText(reason), c.category))
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
