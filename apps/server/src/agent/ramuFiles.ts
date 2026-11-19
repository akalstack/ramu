import { join, resolve, sep } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { defaultUserData } from '../config'
import type { CommandScope } from './dangerousCommands'

/** Ramu's own data folder: its settings, database, credentials and device pairings. */
const ramuDataDir = () => resolve(process.env.RAMU_USER_DATA || defaultUserData())

const within = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

export const RAMU_FILES_REFUSAL =
  'Ramu’s own settings and data are not edited as files. Use settings_find and settings_change, which show the person a card; anything else in Ramu’s data folder is changed from Ramu itself.'

/**
 * Why a file tool may not write `path`, or null when it may. Ramu's data folder is off limits so its settings only
 * change through the typed settings tools, except the thread's own folders (helpers' worktrees can live there);
 * `settings.json` itself is refused even then.
 */
export function ramuFileRefusal(path: unknown, scope: CommandScope, dataDir = ramuDataDir()): string | null {
  if (typeof path !== 'string' || !path) return null
  const target = resolve(scope.cwd, path)
  if (!within(target, dataDir)) return null
  if (target === join(dataDir, 'settings.json')) return RAMU_FILES_REFUSAL
  const roots = [scope.cwd, ...(scope.additionalDirs ?? []), ...(scope.covers ?? [])].map((root) => resolve(root))
  return roots.some((root) => (!within(root, dataDir) || root === dataDir ? false : within(target, root)))
    ? null
    : RAMU_FILES_REFUSAL
}

/** Claude's file-writing tools refuse Ramu's data folder in every access mode, Full access included. */
export function ramuFileHooks(scope: CommandScope): NonNullable<Options['hooks']> {
  return {
    PreToolUse: [
      {
        matcher: 'Edit|Write|MultiEdit|NotebookEdit',
        hooks: [
          async (input) => {
            if (input.hook_event_name !== 'PreToolUse') return {}
            const toolInput = (input.tool_input ?? {}) as { file_path?: unknown; notebook_path?: unknown }
            const reason = ramuFileRefusal(toolInput.file_path ?? toolInput.notebook_path, scope)
            return reason
              ? {
                  hookSpecificOutput: {
                    hookEventName: 'PreToolUse' as const,
                    permissionDecision: 'deny' as const,
                    permissionDecisionReason: reason,
                  },
                }
              : {}
          },
        ],
      },
    ],
  }
}
