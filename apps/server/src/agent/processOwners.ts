import { spawn, type ChildProcess } from 'node:child_process'
import { AsyncLocalStorage } from 'node:async_hooks'
import type { SpawnedProcess, SpawnOptions } from '@anthropic-ai/claude-agent-sdk'
import { OWNER_ENV } from '@ramu/shared/servers'

// Which session started which provider process, for Resources. Providers spawn deep inside their own startup, so the
// session is carried in async context rather than threaded through every constructor.
const owner = new AsyncLocalStorage<string>()
const roots = new Map<number, string>()

export const asProcessOwner = <T>(sessionId: string, work: () => T): T => owner.run(sessionId, work)

/** Records a provider process under the session starting it; a process with no session stays Ramu's own. */
export function trackProcess<T extends ChildProcess>(child: T, sessionId = owner.getStore()): T {
  const { pid } = child
  if (pid && sessionId) {
    roots.set(pid, sessionId)
    child.once('exit', () => roots.delete(pid))
  }
  return child
}

export const processRoots = (): ReadonlyMap<number, string> => roots

/**
 * Names the session in the environment of the process being started, which everything it runs inherits. A server an
 * agent starts with `nohup` or `&` leaves the process tree, but still shows under its thread by this name.
 */
export function ownedEnvironment<T extends NodeJS.ProcessEnv | Record<string, string>>(
  env: T,
  sessionId = owner.getStore(),
): T {
  return sessionId ? { ...env, [OWNER_ENV]: sessionId } : env
}

/** The SDK starts Claude Code itself; this keeps its usual launch and learns the process id it otherwise hides. */
export const claudeSpawn =
  (sessionId: string) =>
  ({ command, args, cwd, env, signal }: SpawnOptions): SpawnedProcess =>
    trackProcess(
      spawn(command, args, { cwd, env: ownedEnvironment(env, sessionId), signal, stdio: ['pipe', 'pipe', 'ignore'] }),
      sessionId,
    )
