// Pushes an agent makes with `git push` in its own shell, and pull request commands it runs with `gh pr`. Once such a
// command finishes without an error, a push is followed like one from Source Control, so CI on the default branch and the
// platform's deployment can wake the thread, and either one has the checkout's pull request read again at once.
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
/** A `gh pr` command that changes a pull request: opening, merging, closing, reopening, editing or reviewing one. */
const GH_PR_CHANGE = /(?:^|[\s;&|(])gh\s+pr\s+(?:create|merge|close|reopen|ready|edit|review|comment)\b/
export type ShellChange = 'push' | 'pull-request'
const KEEP = 200

export class ShellPushes {
  private readonly pending = new Map<string, ShellChange>()

  constructor(private readonly changed: (sessionId: string, change: ShellChange) => void) {}

  observe(sessionId: string, event: AgentEvent): void {
    if (event.kind === 'tool-use') {
      if (event.toolKind !== 'execute' && !SHELL_TOOLS.has(event.name)) return
      const command = `${event.input ?? ''}\n${event.summary}`
      const change: ShellChange | null = GIT_PUSH.test(command)
        ? 'push'
        : GH_PR_CHANGE.test(command)
          ? 'pull-request'
          : null
      if (!change) return
      this.pending.set(`${sessionId}:${event.toolUseId}`, change)
      if (this.pending.size > KEEP) this.pending.delete(this.pending.keys().next().value!)
      return
    }
    if (event.kind !== 'tool-result' || event.running) return
    const key = `${sessionId}:${event.toolUseId}`
    const change = this.pending.get(key)
    if (!change) return
    this.pending.delete(key)
    if (!event.isError) this.changed(sessionId, change)
  }
}
