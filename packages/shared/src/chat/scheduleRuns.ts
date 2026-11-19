import type { Task } from '../types'
import { threadStatus } from './threadStatus'

/**
 * A recurring schedule reads as one row, its newest run. An older run stays in the list while it still has something to
 * show: it is open, unread or has a status of its own. Expects `tasks` newest first. `earlierRuns` counts the runs folded
 * into each newest run, by its id. The desktop sidebar and the phone's Threads tab both use it.
 */
export function collapseScheduleRuns<T extends Task>(tasks: readonly T[], keep: (task: T) => boolean) {
  const newest = new Map<string, T>()
  const earlierRuns: Record<string, number> = {}
  const visible = tasks.filter((task) => {
    if (!task.scheduleId) return true
    const lead = newest.get(task.scheduleId)
    if (!lead) {
      newest.set(task.scheduleId, task)
      return true
    }
    if (keep(task) || threadStatus(task, false, task.goalState)) return true
    earlierRuns[lead.id] = (earlierRuns[lead.id] ?? 0) + 1
    return false
  })
  return { visible, earlierRuns }
}
