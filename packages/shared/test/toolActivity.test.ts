import { expect, it } from 'vitest'
import { toolActivity } from '../src/chat/toolActivity'
it('shows the newest live step, then unresolved failure, then the last completed step', () => {
  const tools = [
    { id: 'a', status: 'running' },
    { id: 'b', status: 'failed' },
    { id: 'c', status: 'running' },
  ]
  const status = (tool: (typeof tools)[number]) => tool.status as 'running' | 'failed' | 'done'
  expect(toolActivity(tools, status)).toMatchObject({ current: { id: 'c' }, running: 2, failed: 1 })
  tools[0]!.status = tools[2]!.status = 'done'
  expect(toolActivity(tools, status)).toMatchObject({ current: { id: 'b' }, running: 0, failed: 1 })
  tools[1]!.status = 'done'
  expect(toolActivity(tools, status).current?.id).toBe('c')
  expect(toolActivity([], status).current).toBeUndefined()
})
