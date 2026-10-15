import type { Task } from '@ramu/shared/types'

/** Every chat a title search should consider: live ones first, then archived. Empty-query lists should still use live chats only. */
export function searchableChats(tasks: Task[]): Task[] {
  return [...tasks.filter((task) => task.status !== 'archived'), ...tasks.filter((task) => task.status === 'archived')]
}
