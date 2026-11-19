// One-tap actions the Inbox runs on a thread, on the host that owns it, through that host's ordinary methods.
import type { AgentSessionInfo } from '../types'

type Invoke = (hostId: string, method: string, ...args: unknown[]) => Promise<unknown>
type ThreadRef = { hostId: string; taskId: string }

const RETRY_TEXT = 'Continue where you left off.'

async function latestSession(invoke: Invoke, thread: ThreadRef): Promise<AgentSessionInfo> {
  const sessions = (await invoke(thread.hostId, 'agent.list', thread.taskId)) as AgentSessionInfo[]
  const session = sessions.at(-1)
  if (!session) throw new Error('That thread has no agent.')
  return session
}

/** Continues a failed or stopped thread on its own host. */
export async function retryThread(invoke: Invoke, thread: ThreadRef) {
  const session = await latestSession(invoke, thread)
  await invoke(thread.hostId, 'agent.submit', session.id, RETRY_TEXT, 'queue')
}

/** Stops the agents of threads with no turn in progress; each keeps its transcript and continues on the next message. */
export async function stopIdleThreads(invoke: Invoke, hostId: string, taskIds: readonly string[]) {
  for (const taskId of taskIds) {
    const session = await latestSession(invoke, { hostId, taskId }).catch(() => null)
    if (session) await invoke(hostId, 'agent.stop', session.id)
  }
}
