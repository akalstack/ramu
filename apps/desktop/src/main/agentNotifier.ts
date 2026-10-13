import { t } from './localization'
import { Notification, type BrowserWindow } from 'electron'
import type { AgentSessionInfo, AgentSessionState, AppPreferences, ChatGoal, Task } from '@ramu/shared/types'

export type AgentNotice = { sessionId: string; taskId: string; kind: 'done' | 'input' | 'failed'; title: string; body: string }

const COPY = { done: 'Finished', input: 'Needs your input', failed: 'Stopped with an error' } as const
const ACTIVE: AgentSessionState[] = ['starting', 'running', 'needs-input']

/**
 * Tells the user when an agent finishes, needs input or fails. In the foreground the app shows its own
 * toast; in the background it sends a system notification. Clicking either opens the chat.
 */
export function createAgentNotifier(options: {
  window: BrowserWindow
  send: (channel: string, payload: unknown) => void
  invoke: (method: string, args?: unknown[]) => Promise<unknown>
}) {
  const last = new Map<string, AgentSessionState>()
  const live = new Set<Notification>()
  const questionsSeen = new Set<string>()
  const open = (notice: AgentNotice) => {
    const win = options.window
    if (win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show(); win.focus()
    options.send('notify:open', { taskId: notice.taskId, sessionId: notice.sessionId })
  }
  const deliver = async (sessionId: string, kind: AgentNotice['kind'], body?: string) => {
    try {
      const prefs = await options.invoke('settings.app.get') as AppPreferences
      if (!prefs.notifyAgentDone) return
      const session = await options.invoke('agent.get', [sessionId]) as AgentSessionInfo
      if (kind === 'done') {
        const goal = await options.invoke('agent.goal', [sessionId]) as ChatGoal | null
        if (goal && ['active', 'waiting-provider', 'blocked'].includes(goal.status)) return
      }
      const task = ((await options.invoke('tasks.list')) as Task[]).find((entry) => entry.id === session.taskId)
      // A sub-agent only ever needs you when it asks for approval; finishing or failing is reported in its chat.
      if (session.parentId && kind !== 'input') return
      const notice: AgentNotice = { sessionId: session.parentId ?? sessionId, taskId: session.taskId, kind, title: task?.title || session.title || t('Chat'), body: t(body ?? COPY[kind]) }
      const win = options.window
      if (win.isDestroyed()) return
      if (win.isFocused() && win.isVisible() && !win.isMinimized()) { options.send('notify:inapp', notice); return }
      if (!Notification.isSupported()) return
      const system = new Notification({ title: notice.title, body: notice.body, silent: false })
      live.add(system)
      system.on('click', () => { live.delete(system); open(notice) })
      system.on('close', () => live.delete(system))
      system.show()
    } catch { /* A notification is never worth interrupting the app for. */ }
  }
  return {
    observe(channel: string, payload: unknown) {
      if (channel !== 'agent:event') return
      const { sessionId, event } = payload as { sessionId: string; event: { kind: string; state?: AgentSessionState; responseMode?: string; requestId?: string; goal?: ChatGoal | null } }
      if (event.kind === 'goal' && event.goal && ['blocked', 'turn-limit'].includes(event.goal.status)) void deliver(sessionId, 'input', event.goal.status === 'blocked' ? 'Goal needs input' : 'Goal turn limit reached')
      if (event.kind === 'question' && event.responseMode === 'message' && event.requestId && !questionsSeen.has(event.requestId)) {
        questionsSeen.add(event.requestId)
        if (questionsSeen.size > 500) questionsSeen.delete(questionsSeen.values().next().value!)
        void deliver(sessionId, 'input', 'Has a question. Independent work can continue.')
      }
      if (event.kind !== 'state' || !event.state) return
      const previous = last.get(sessionId)
      last.set(sessionId, event.state)
      if (!previous || !ACTIVE.includes(previous)) return
      if (event.state === 'idle' && previous !== 'needs-input') void deliver(sessionId, 'done')
      else if (event.state === 'needs-input' && previous !== 'needs-input') void deliver(sessionId, 'input')
      else if (event.state === 'failed') void deliver(sessionId, 'failed')
    },
  }
}
