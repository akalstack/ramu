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
  return sessionId ? { ...env, [OWNER_ENV]: sessionId, ...daemonTimeouts(env) } : env
}

/** How long a build daemon an agent started stays up with nothing to build, instead of the tools' hours. */
export const AGENT_DAEMON_IDLE_MS = 10 * 60_000

/**
 * A build an agent runs leaves its daemon behind for the next one, for hours by default; one that quits after ten idle
 * minutes still speeds up the agent's next build. Gradle's compiler daemons end with it. A timeout the person set wins.
 */
export function daemonTimeouts(env: NodeJS.ProcessEnv | Record<string, string>): { GRADLE_OPTS?: string } {
  const current = env.GRADLE_OPTS ?? ''
  if (current.includes('org.gradle.daemon.idletimeout')) return {}
  return { GRADLE_OPTS: `${current} -Dorg.gradle.daemon.idletimeout=${AGENT_DAEMON_IDLE_MS}`.trim() }
}

/** The SDK starts Claude Code itself; this keeps its usual launch and learns the process id it otherwise hides. */
export const claudeSpawn =
  (sessionId: string) =>
  ({ command, args, cwd, env, signal }: SpawnOptions): SpawnedProcess =>
    trackProcess(
      spawn(command, args, { cwd, env: ownedEnvironment(env, sessionId), signal, stdio: ['pipe', 'pipe', 'ignore'] }),
      sessionId,
    )
