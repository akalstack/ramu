import type { Task } from '../types'

export type GroupMemberState = 'running' | 'waiting' | 'failed' | 'finished' | 'stopped'

export interface StartedGroupMember {
  hostId: string
  task: Task
  state: GroupMemberState
}

export interface StartedGroup {
  groupId: string
  /** Members on every connected host; a host that is not connected contributes none. */
  members: StartedGroupMember[]
  counts: Record<GroupMemberState, number>
  /** Newest start in the group. */
  startedAt: number
}

/** How long a group of threads one Home prompt started stays on Home once all of it is settled. */
export const SETTLED_GROUP_DAYS = 3

export function memberState(task: Task): GroupMemberState {
  if (task.inputSummary || task.executionState === 'needs-input') return 'waiting'
  if (task.executionState === 'running' || task.executionState === 'starting') return 'running'
  if (task.executionState === 'failed') return 'failed'
  if (task.executionState === 'stopped') return 'stopped'
  return 'finished'
}

/**
 * Groups of threads that one Home prompt started together, across every connected host, newest first. A group stays
 * while any member is working or waiting, and for a few days after all of them settle; archived threads drop out.
 */
export function startedGroups(hosts: { hostId: string; tasks: readonly Task[] }[], now = Date.now()): StartedGroup[] {
  const groups = new Map<string, StartedGroup>()
  for (const { hostId, tasks } of hosts)
    for (const task of tasks) {
      const origin = task.startedFrom
      // Only Home groups: a thread an agent started, here or on another host, belongs to that agent's thread.
      if (!origin || origin.taskId !== null || origin.host || task.status === 'archived') continue
      const group = groups.get(origin.groupId) ?? {
        groupId: origin.groupId,
        members: [],
        counts: { running: 0, waiting: 0, failed: 0, finished: 0, stopped: 0 },
        startedAt: 0,
      }
      const state = memberState(task)
      group.members.push({ hostId, task, state })
      group.counts[state]++
      group.startedAt = Math.max(group.startedAt, task.createdAt)
      groups.set(origin.groupId, group)
    }
  return [...groups.values()]
    .filter(
      (group) =>
        group.members.length > 1 &&
        (group.counts.running + group.counts.waiting > 0 || now - group.startedAt < SETTLED_GROUP_DAYS * 86_400_000),
    )
    .sort((a, b) => b.startedAt - a.startedAt)
}

/** One line for a whole group, as an English key and values to translate: what needs the person first, then what is still working, then the outcome. */
export function groupSummary(group: StartedGroup): { text: string; values: Record<string, number> } {
  const { running, waiting, failed, stopped } = group.counts
  const size = group.members.length
  if (waiting) return { text: '{0} waiting for you', values: { '0': waiting } }
  if (running) return { text: '{0} of {1} still working', values: { '0': running, '1': size } }
  if (failed || stopped)
    return {
      text: 'All settled: {0} finished, {1} did not',
      values: { '0': size - failed - stopped, '1': failed + stopped },
    }
  return { text: 'All {0} finished', values: { '0': size } }
}
