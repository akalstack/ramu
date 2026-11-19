// Pushes an agent makes with `git push` in its own shell. Once such a command finishes without an error, the push is
// followed like one from Source Control, so CI on the default branch and the platform's deployment can wake the thread.
import type { AgentEvent } from '@ramu/shared/types'

const SHELL_TOOLS = new Set([
  'Bash',
  'bash',
  'shell',
  'command',
  'execute',
  'run_command',
  'exec_command',
  'local_shell',
])
/** `git push`, also after `git -C dir`, as one of the commands of a line. */
const GIT_PUSH = /(?:^|[\s;&|(])git(?:\s+-[cC]\s+\S+)*\s+push\b/
const KEEP = 200

export class ShellPushes {
  private readonly pending = new Map<string, string>()

  constructor(private readonly pushed: (sessionId: string) => void) {}

  observe(sessionId: string, event: AgentEvent): void {
    if (event.kind === 'tool-use') {
      if (event.toolKind !== 'execute' && !SHELL_TOOLS.has(event.name)) return
      if (!GIT_PUSH.test(`${event.input ?? ''}\n${event.summary}`)) return
      this.pending.set(`${sessionId}:${event.toolUseId}`, sessionId)
      if (this.pending.size > KEEP) this.pending.delete(this.pending.keys().next().value!)
      return
    }
    if (event.kind !== 'tool-result' || event.running) return
    const key = `${sessionId}:${event.toolUseId}`
    if (!this.pending.has(key)) return
    this.pending.delete(key)
    if (!event.isError) this.pushed(sessionId)
  }
}
