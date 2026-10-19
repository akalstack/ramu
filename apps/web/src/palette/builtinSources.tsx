import { FolderTree, Sparkles, SquareChevronRight } from 'lucide-react'
import { searchableChats } from '../chat/chatSearch'
import type { Command } from '../commands'
import { FileIcon } from '../editor/FileIcon'
import { t } from '../i18n'
import { invoke } from '../ipc'
import { fuzzy } from '../lib/fuzzy'
import { titleFrom } from '../NewTask'
import type { AgentSettings } from '@ramu/shared/types'
import { isWorkspaceCtx, isWorktreeCtx, type WorkspaceApi } from '../workspace/workspace'
import { rankTop, type PaletteResult, type PaletteSource } from './sources'

const cheap = { debounceMs: 0, minLength: 0 }
const clampPosition = (value: number) => Math.max(1, Math.min(value, 1_000_000))

/** `>` runs commands. Recently used ones lead while the query is empty. */
export function commandsSource(commands: Command[], recent: string[], remember: (id: string) => void): PaletteSource {
  return {
    id: 'commands',
    label: t('Commands'),
    priority: 0,
    modes: ['commands'],
    ...cheap,
    limit: 80,
    initialShow: 80,
    query(text) {
      const seen = new Set<string>()
      const eligible = commands.filter((command) => {
        if ((command.when && !command.when()) || seen.has(command.title)) return false
        seen.add(command.title)
        return true
      })
      const matches = new Map<string, number[]>()
      const ranked = rankTop(
        eligible,
        (command) => {
          const match = fuzzy(text, `${command.category}: ${command.title}`)
          if (!match) return null
          matches.set(command.id, match.hits)
          return match.score + (!text && recent.includes(command.id) ? 1000 - recent.indexOf(command.id) : 0)
        },
        80,
      )
      return {
        limited: ranked.total > 80,
        results: ranked.items.map((command): PaletteResult => ({
          key: command.id,
          icon: <SquareChevronRight size={14} />,
          label: `${command.category}: ${command.title}`,
          hits: matches.get(command.id),
          keys: command.keys,
          run: () => {
            remember(command.id)
            return command.run()
          },
        })),
      }
    },
  }
}

/** Files by name; `path:line:column` opens the file there. */
export function filesSource(
  ws: WorkspaceApi,
  taskId: string | null,
  files: { repoId: string; path: string }[],
): PaletteSource {
  return {
    id: 'files',
    label: t('Files'),
    priority: 10,
    modes: ['all'],
    ...cheap,
    limit: 100,
    initialShow: 12,
    query(text) {
      const location = /:(\d+)(?::(\d+))?$/.exec(text)
      const fileQuery = location ? text.slice(0, location.index) : text
      const multiRepo = taskId ? (ws.bindings[taskId] ?? []).length > 1 : false
      const matches = new Map<{ repoId: string; path: string }, number[]>()
      const ranked = rankTop(
        files,
        (file) => {
          const match = fuzzy(fileQuery, file.path)
          if (!match) return null
          matches.set(file, match.hits)
          return match.score
        },
        text ? 100 : 12,
      )
      return {
        limited: ranked.total > ranked.items.length,
        results: ranked.items.map((file) => ({
          key: `${file.repoId}:${file.path}`,
          icon: <FileIcon path={file.path} />,
          label: file.path,
          hits: matches.get(file),
          detail: multiRepo && taskId ? ws.binding(taskId, file.repoId)?.repoName : undefined,
          run: () =>
            taskId &&
            ws.openView(taskId, {
              kind: 'file',
              repoId: file.repoId,
              path: file.path,
              preview: false,
              ...(location
                ? {
                    selection: {
                      line: clampPosition(Number(location[1])),
                      column: clampPosition(Number(location[2] ?? 1)),
                      endColumn: clampPosition(Number(location[2] ?? 1)),
                      requestId: crypto.randomUUID(),
                    },
                  }
                : {}),
            }),
        })),
      }
    },
  }
}

export function projectsSource(ws: WorkspaceApi): PaletteSource {
  return {
    id: 'projects',
    label: t('Projects'),
    priority: 20,
    modes: ['all'],
    debounceMs: 0,
    minLength: 1,
    limit: 20,
    initialShow: 5,
    query(text) {
      const ranked = rankTop(
        ws.projects,
        (project) => fuzzy(text, `${project.name} ${project.root ?? ''}`)?.score ?? null,
        20,
      )
      return {
        limited: ranked.total > ranked.items.length,
        results: ranked.items.map((project) => ({
          key: project.id,
          icon: <FolderTree size={14} />,
          label: project.name,
          detail: project.root ?? undefined,
          run: () => ws.openProject(project.id),
        })),
      }
    },
  }
}

/** Chat titles; live chats outrank archived ones at equal score because they come first. */
export function chatsSource(ws: WorkspaceApi): PaletteSource {
  return {
    id: 'chats',
    label: t('Threads'),
    priority: 30,
    modes: ['all'],
    debounceMs: 0,
    minLength: 1,
    limit: 50,
    initialShow: 8,
    query(text) {
      const matches = new Map<string, number[]>()
      const ranked = rankTop(
        searchableChats(ws.tasks),
        (chat) => {
          const match = fuzzy(text, chat.title)
          if (!match) return null
          matches.set(chat.id, match.hits)
          return match.score
        },
        50,
      )
      return {
        limited: ranked.total > ranked.items.length,
        results: ranked.items.map((chat) => ({
          key: chat.id,
          icon: <FolderTree size={14} />,
          label: chat.title,
          hits: matches.get(chat.id),
          detail:
            [
              ws.projects.find((project) => project.id === chat.projectId)?.name,
              chat.status === 'archived' ? t('Archived') : undefined,
            ]
              .filter(Boolean)
              .join(' · ') || undefined,
          run: () => ws.openTask(chat.id),
        })),
      }
    },
  }
}

/** Sends what was typed to the open conversation, or starts a chat with it. */
export function agentSource(
  ws: WorkspaceApi,
  taskId: string,
  initialSettings: AgentSettings,
  call: typeof invoke = invoke,
): PaletteSource {
  return {
    id: 'agent',
    label: t('Agent'),
    priority: 1000,
    modes: ['all'],
    debounceMs: 0,
    minLength: 1,
    limit: 1,
    initialShow: 1,
    query(text) {
      const state = ws.taskUi[taskId]
      const chat = state?.views.find((view) => view.id === state.activeAgentViewId && view.kind === 'agent')
      return {
        results: [
          {
            key: 'ask',
            icon: <Sparkles size={14} />,
            label: text,
            detail: chat ? t('Send to the agent') : t('Start a thread with the agent'),
            run: async () => {
              if (chat?.kind === 'agent') {
                await call('agent.send', chat.sessionId, text)
                ws.activateView(taskId, chat.id)
              } else if (isWorkspaceCtx(taskId)) {
                // From a project's workspace view, a message starts a new chat (task) in that project.
                const task = await call('tasks.create', {
                  projectId: ws.projectOf(taskId)!.id,
                  title: titleFrom(text),
                  mode: isWorktreeCtx(taskId) ? 'worktree' : 'current',
                  workspaceId: isWorktreeCtx(taskId) ? taskId.slice('worktree:'.length) : undefined,
                })
                await ws.refresh()
                ws.openTask(task.id)
                const session = await call('agent.start', task.id, text, initialSettings)
                ws.openView(task.id, { kind: 'agent', sessionId: session.id })
              } else {
                const session = await call('agent.start', taskId, text, initialSettings)
                ws.openView(taskId, { kind: 'agent', sessionId: session.id })
              }
            },
          },
        ],
      }
    },
  }
}
