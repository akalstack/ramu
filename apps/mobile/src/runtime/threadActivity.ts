import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { threadActivity } from '@ramu/shared/chat/threadActivity'
import { isLimitHold } from '@ramu/shared/chat/goalHold'
import { isDeviceTool } from '@ramu/shared/chat/deviceTools'
import type { Chat, TranscriptItem } from './types'
/**
 * Commands the provider itself moved to the background, shaped like a helper so the helper sheet can show their output
 * and stop them. They are processes, not agents, so they are listed with the background terminals.
 */
export const providerCommands = (chat: Chat) =>
  (chat.commands ?? []).map((task) => ({ ...task, id: task.agentId, type: task.taskType ?? '' }))

export function mobileThreadActivity(chat: Chat, connected: boolean) {
  const lastUser = chat.items.findLastIndex((item) => item.kind === 'user')
  const groups = chat.items.flatMap((item, index) => (item.kind === 'agents' ? [{ item, index }] : []))
  const helpers = [
    ...groups
      .filter(({ item }) => !item.advisor)
      .flatMap(({ item, index }) =>
        item.agents.filter((task) => (index >= lastUser && lastUser >= 0 && !item.earlier) || helperActive(task)),
      ),
  ]
  const advisors = groups.filter(({ item }) => item.advisor).flatMap(({ item }) => item.agents)
  const requests = chat.items.filter(
    (item) =>
      (item.kind === 'permission' && item.decision === undefined) ||
      (item.kind === 'question' && item.answers === undefined) ||
      (item.kind === 'elicitation' && item.outcome === undefined) ||
      (item.kind === 'secret' && item.outcome === undefined),
  )
  const wait = chat.items.findLast((item) => item.kind === 'note' && item.wait)
  const waitIndex = wait ? chat.items.indexOf(wait) : -1
  const afterWait = chat.items
    .slice(waitIndex + 1)
    .some((item) => item.kind === 'user' || item.kind === 'text' || item.kind === 'tool' || item.kind === 'error')
  const goal =
    !chat.goal || chat.goal.status === 'completed'
      ? null
      : isLimitHold(chat.goal)
        ? 'provider'
        : chat.goal.status === 'active'
          ? chat.goal.claim
            ? 'verifying'
            : 'active'
          : chat.goal.status === 'paused'
            ? 'paused'
            : chat.goal.status === 'turn-limit'
              ? 'turn-limit'
              : 'blocked'
  return {
    helpers,
    advisors,
    requests,
    groups: groups.map(({ item }) => item),
    model: threadActivity({
      connected,
      working: chat.status === 'running' || Boolean(chat.compacting),
      helpers,
      advisors,
      // A secret counts as a question: it waits for the person, with no approval to give.
      requests: requests.map((item) => ({
        id: item.id,
        kind: item.kind === 'secret' ? 'question' : (item.kind as 'permission' | 'question' | 'elicitation'),
      })),
      // The limit tray above the composer covers a thread waiting at its limit; the pill marks only a try in progress,
      // when the tray steps aside.
      providerWait: Boolean(wait) && !afterWait && !chat.doneAt && chat.status === 'running',
      queue: chat.queue.length,
      goal,
    }),
  }
}
export const pendingRequest = (item: TranscriptItem) =>
  (item.kind === 'permission' && item.decision === undefined) ||
  (item.kind === 'question' && item.answers === undefined) ||
  (item.kind === 'elicitation' && item.outcome === undefined) ||
  (item.kind === 'secret' && item.outcome === undefined)

/**
 * The thread's newest browser or computer call and how it stands, as a key that changes whenever the agent opens,
 * moves or closes a tab or takes the computer. A browser opened on the desktop is announced only inside the desktop
 * app, so the phone reads its chips again when this changes.
 */
export function deviceToolKey(items: readonly TranscriptItem[]): string {
  for (let index = items.length - 1; index >= 0; index--) {
    const item = items[index]!
    const tools = item.kind === 'tool' ? [item] : item.kind === 'tools' ? item.tools : []
    const last = tools.findLast((tool) => isDeviceTool(tool.source.name))
    if (last) return `${last.id}:${last.status}`
  }
  return ''
}
