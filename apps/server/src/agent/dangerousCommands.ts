import { commandDeploy } from '@ramu/shared/deployActions'

/**
 * The one command Ramu itself asks about at every access level: a deploy to production. Everything else follows the
 * thread's access level and the agent's own checks, as T3 Code does: under Full access Claude's own safety checks and
 * the commands Codex judges dangerous still ask, and Ramu passes those to the person.
 */

/** Where a command runs and the folders the thread works in. */
export interface CommandScope {
  cwd: string
  additionalDirs?: string[]
  covers?: string[]
}

/** A shell's `-c` script (`bash -lc "vercel deploy --prod"`, as Codex sends commands), else the command itself. */
const SHELL_SCRIPT = /^\s*(?:\S*\/)?(?:ba|z|da|k)?sh\s+(?:-\w*c\w*\s+)(['"]?)([\s\S]*)\1\s*$/

/** Why a command asks at every access level: it deploys to production. */
export function productionDeploy(command: string): string | null {
  const script = SHELL_SCRIPT.exec(command)?.[2]
  return commandDeploy(command) === 'production' || (script !== undefined && commandDeploy(script) === 'production')
    ? 'Deploys to production'
    : null
}
