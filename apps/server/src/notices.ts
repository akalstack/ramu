import type { AgentEvent } from '@ramu/shared/types'
import type { InboxNotice } from '@ramu/shared/notices'

/**
 * What needs a person's attention, kept on the host so every device agrees: a notice raised while the phone was
 * asleep is waiting on the desktop, and dismissing it on one clears it on the other.
 */
export class NoticeInbox {
  private items: InboxNotice[] = []
  private readonly last = new Map<string, string>()

  constructor(private readonly changed: (items: InboxNotice[]) => void, private readonly titleOf: (taskId: string) => string) {}

  list(): InboxNotice[] { return this.items }

  observe(session: { id: string; taskId: string; parentId?: string | null }, event: AgentEvent): void {
    if (session.parentId || event.kind !== 'state') return
    const before = this.last.get(session.id)
    this.last.set(session.id, event.state)
    const id = `agent:${session.id}`
    // The chat moved on, so an older notice about it is stale.
    if (event.state === 'running' || event.state === 'starting') { this.dismiss(id); return }
    const kind: InboxNotice['kind'] | null = event.state === 'needs-input' ? 'input' : event.state === 'failed' ? 'failed' : event.state === 'idle' && (before === 'running' || before === 'starting' || before === 'needs-input') ? 'done' : null
    if (!kind) return
    const body = kind === 'done' ? 'Finished' : kind === 'failed' ? 'Stopped with an error' : 'Needs your input'
    this.set([{ id, taskId: session.taskId, sessionId: session.id, kind, title: this.titleOf(session.taskId), body, at: Date.now() }, ...this.items.filter(item => item.id !== id)].slice(0, 50))
  }

  dismiss(id: string): void { if (this.items.some(item => item.id === id)) this.set(this.items.filter(item => item.id !== id)) }
  clear(): void { if (this.items.length) this.set([]) }
  /** A deleted chat leaves no notice behind. */
  forgetTask(taskId: string): void { if (this.items.some(item => item.taskId === taskId)) this.set(this.items.filter(item => item.taskId !== taskId)) }
  private set(items: InboxNotice[]) { this.items = items; this.changed(items) }
}
