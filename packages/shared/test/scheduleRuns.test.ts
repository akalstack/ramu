import { describe, expect, it } from 'vitest'
import { collapseScheduleRuns } from '../src/chat/scheduleRuns'
import { threadOriginLabel } from '../src/workspace/threadOrigin'
import type { Task, ThreadOrigin } from '../src/types'

const run = (id: string, scheduleId?: string, extra: Partial<Task> = {}) =>
  ({ id, status: 'idle', ...(scheduleId ? { scheduleId } : {}), ...extra }) as Task

describe('schedule runs', () => {
  it('keeps a schedule’s newest run and folds older quiet ones into it', () => {
    const tasks = [run('n3', 'daily'), run('other'), run('n2', 'daily'), run('n1', 'daily')]
    const { visible, earlierRuns } = collapseScheduleRuns(tasks, () => false)
    expect(visible.map((task) => task.id)).toEqual(['n3', 'other'])
    expect(earlierRuns).toEqual({ n3: 2 })
  })

  it('keeps an older run that is unread or still has a status of its own', () => {
    const tasks = [run('n3', 'daily'), run('n2', 'daily', { status: 'failed' }), run('n1', 'daily')]
    const { visible, earlierRuns } = collapseScheduleRuns(tasks, (task) => task.id === 'n1')
    expect(visible.map((task) => task.id)).toEqual(['n3', 'n2', 'n1'])
    expect(earlierRuns).toEqual({})
  })
})

describe('thread origin', () => {
  const t = (text: string, values: Record<string, string> = {}) =>
    text.replace(/\{(\d)\}/g, (_, key: string) => values[key] ?? '')
  const origin = (extra: Partial<ThreadOrigin>) => ({ groupId: 'g', ...extra }) as ThreadOrigin

  it('names who started a thread, the same on the desktop and the phone', () => {
    expect(threadOriginLabel(origin({ groupId: 'terminal:x', host: 'mini' }), t)).toBe(
      'Started from a terminal by mini',
    )
    expect(threadOriginLabel(origin({ host: 'vps' }), t)).toBe('Started by an agent on vps')
    expect(threadOriginLabel(origin({ title: 'Fix login' }), t)).toBe('Started by the agent in Fix login')
    expect(threadOriginLabel(origin({}), t)).toBe('Started by another thread')
  })
})
