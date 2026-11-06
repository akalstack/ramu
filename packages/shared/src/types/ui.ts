// ---- UI persistence ----

export type ViewDescriptor =
  | {
      kind: 'agent'
      id: string
      sessionId: string
      repoId?: string
      sourceSeq?: number
      sourceRequestId?: string
      focusRequestId?: string
    }
  | {
      kind: 'file'
      id: string
      repoId: string
      path: string
      preview?: boolean
      selection?: { line: number; column: number; endColumn: number; requestId: string }
    }
  | {
      kind: 'diff'
      id: string
      repoId: string
      path: string
      staged: boolean | 'all'
      stash?: boolean
      oid?: string
      preview?: boolean
    }
  | { kind: 'git'; id: string; repoId: string; title: string; oid?: string; preview?: boolean }
  /** A conflicted file, one conflict at a time, with a side to keep for each. */
  | { kind: 'conflict'; id: string; repoId: string; path: string }
  /** A pull request of the repository: its state, checks, review threads, drafted replies and actions. */
  | { kind: 'pull-request'; id: string; repoId: string; url: string; number: number; title: string }
  | {
      kind: 'review'
      id: string
      repoId?: string
      reviewId: string
      taskId: string
      fileId?: string
      threadId?: string
      requestId?: string
    }
  /** An integrated-browser tab of this computer's desktop app. The page itself lives in the shell; `url` is where a restored tab reopens. */
  | { kind: 'browser'; id: string; url?: string; tabId?: string; profileId?: string }
  /** Without a repoId the terminal starts where the task's agent runs (the workspace). */
  /** A project action's terminal carries its name and command; the command runs once, right after `runAt`, and not again when the view is restored. */
  | {
      kind: 'terminal'
      id: string
      repoId?: string
      title?: string
      command?: string
      runAt?: number
      backgroundId?: string
    }

export interface TaskUiState {
  terminalGroups?: TerminalGroup[]
  views: ViewDescriptor[]
  /** Active workspace tab (file, review, or terminal) or conversation. Bottom terminals have independent focus. */
  activeViewId: string | null
  /** Last focused conversation, kept visible beside the workspace. */
  activeAgentViewId?: string | null
  /** Last editor tab shown before the workspace was hidden, so reopening returns to it. */
  lastWorkspaceViewId?: string | null
  /** The terminal panel was open when the workspace was hidden; reopen it with the workspace. */
  restoreTerminal?: boolean
  /** Dock width in px when files are open beside the conversation. */
  dockWidth?: number
  activeTerminalId?: string | null
  /** Workspace selection to restore when a terminal leaves the shared tab area. */
  terminalReturnViewId?: string | null
  terminalOpen?: boolean
  terminalLayout?: 'tabs' | 'horizontal' | 'vertical'
  terminalTabPosition?: 'top' | 'right'
  terminalHeight?: number
  /** 'right' shares the workspace file tabs; 'bottom' keeps a separate terminal panel. */
  terminalDock?: 'right' | 'bottom'
}

export interface TerminalGroup {
  id: string
  terminalIds: string[]
  layout: 'horizontal' | 'vertical'
}

export interface WorkspaceUiState {
  openTaskIds: string[]
  activeTaskId: string | null
  sidebar: 'projects' | 'explorer' | 'search' | 'scm' | 'schedules' | 'inbox' | 'artifacts'
  /** Sidebar sections and projects the user folded (`section:pinned`, `project:<id>`); everything else is open. */
  collapsed?: string[]
  /** What the right-side toggle hid (tool panel and/or workspace), restored when it is toggled back. */
  hiddenRight?: { tool: 'explorer' | 'search' | 'scm' | null; workspace: boolean }
}
