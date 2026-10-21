import { helperActive } from '@ramu/shared/chat/helperPresentation'
import { threadActivity } from '@ramu/shared/chat/threadActivity'
import { isLimitHold } from '@ramu/shared/chat/goalHold'
import type { Chat, TranscriptItem } from './types'
/** Old phone caches stored a reduced lifetime group; restore identity without inventing capabilities. */
export function normalizeHelperGroups(items: TranscriptItem[]): TranscriptItem[] {
  return items.flatMap((item): TranscriptItem[] => {
    if (item.kind !== 'agents') return [item]
    const agents = item.agents.map((task) => ({
      ...task,
      agentId: task.agentId ?? task.id,
      taskType: task.taskType ?? (task.type === 'advisor' ? 'advisor' : undefined),
    }))
    const advisors = agents.filter((task) => item.advisor || task.taskType === 'advisor')
    const helpers = agents.filter((task) => !advisors.includes(task))
    const earlier = item.earlier ?? item.id === 'helpers'
    return [
      ...(helpers.length ? [{ ...item, agents: helpers, advisor: false, earlier }] : []),
      ...(advisors.length
        ? [{ ...item, id: helpers.length ? `${item.id}:advisors` : item.id, agents: advisors, advisor: true, earlier }]
        : []),
    ]
  })
}
export function mobileThreadActivity(chat: Chat, connected: boolean) {
  const lastUser = chat.items.findLastIndex((item) => item.kind === 'user')
  const groups = chat.items.flatMap((item, index) => (item.kind === 'agents' ? [{ item, index }] : []))
  const helpers = groups
    .filter(({ item }) => !item.advisor)
    .flatMap(({ item, index }) =>
      item.agents.filter((task) => (index >= lastUser && lastUser >= 0 && !item.earlier) || helperActive(task)),
    )
  const advisors = groups.filter(({ item }) => item.advisor).flatMap(({ item }) => item.agents)
  const requests = chat.items.filter(
    (item) =>
      (item.kind === 'permission' && item.decision === undefined) ||
      (item.kind === 'question' && item.answers === undefined) ||
      (item.kind === 'elicitation' && item.outcome === undefined),
  )
  const wait = chat.items.findLast((item) => item.kind === 'note' && item.wait)
  const waitIndex = wait ? chat.items.indexOf(wait) : -1
  const afterWait = chat.items
    .slice(waitIndex + 1)
    .some((item) => item.kind === 'user' || item.kind === 'text' || item.kind === 'tool')
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
      requests: requests.map((item) => ({ id: item.id, kind: item.kind as 'permission' | 'question' | 'elicitation' })),
      providerWait: Boolean(wait) && !afterWait,
      queue: chat.queue.length,
      goal,
    }),
  }
}
export const pendingRequest = (item: TranscriptItem) =>
  (item.kind === 'permission' && item.decision === undefined) ||
  (item.kind === 'question' && item.answers === undefined) ||
  (item.kind === 'elicitation' && item.outcome === undefined)
