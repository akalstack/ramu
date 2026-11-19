import { expect, it } from 'vitest'
import { z } from 'zod'
import { registerThreadStartHandlers } from '../src/ipc/handlers/threadStart'
import type { MethodTable } from '../src/ipc/types'

function table(failAt?: 'create' | 'setup' | 'start') {
  const calls: string[] = []
  const base: MethodTable = {
    'tasks.create': {
      args: z.tuple([
        z.object({ projectId: z.string(), mode: z.enum(['current', 'worktree']) }),
        z.array(z.string()).optional(),
      ]),
      run: (input: { projectId: string }) => {
        calls.push('create')
        if (failAt === 'create') throw new Error('No such project')
        return { id: 'task-1', projectId: input.projectId }
      },
    },
    'tasks.setup': {
      args: z.tuple([z.string()]),
      run: (taskId: string) => {
        calls.push(`setup:${taskId}`)
        if (failAt === 'setup') throw new Error('Worktree failed')
      },
    },
    'agent.start': {
      args: z.tuple([
        z.string(),
        z.string().max(10),
        z.unknown().optional(),
        z.array(z.string()).optional(),
        z.unknown().optional(),
      ]),
      run: (taskId: string, prompt: string) => {
        calls.push(`start:${taskId}:${prompt}`)
        if (failAt === 'start') throw new Error('Provider unavailable')
        return { id: 'session-1' }
      },
    },
  }
  return {
    calls,
    run: (...args: unknown[]) => registerThreadStartHandlers(base)['thread.start']!.run(...args) as Promise<any>,
  }
}
const input = (mode: 'current' | 'worktree') => ({ projectId: 'p', mode, title: 'T' })

it('creates and starts a thread on the current checkout without a worktree setup', async () => {
  const { calls, run } = table()
  expect(await run(input('current'), undefined, 'Hi')).toEqual({
    task: { id: 'task-1', projectId: 'p' },
    session: { id: 'session-1' },
  })
  expect(calls).toEqual(['create', 'start:task-1:Hi'])
})

it('sets a new worktree up between creating the thread and starting the agent', async () => {
  const { calls, run } = table()
  await run(input('worktree'), ['plan'], 'Hi')
  expect(calls).toEqual(['create', 'setup:task-1', 'start:task-1:Hi'])
})

it('returns the thread with the error when setup or start fails, so the caller keeps it', async () => {
  for (const [failAt, message] of [
    ['setup', 'Worktree failed'],
    ['start', 'Provider unavailable'],
  ] as const) {
    const { run } = table(failAt)
    expect(await run(input('worktree'), undefined, 'Hi')).toEqual({
      task: { id: 'task-1', projectId: 'p' },
      session: null,
      error: message,
    })
  }
})

it('rejects before creating anything when the thread cannot be created or the start arguments are invalid', async () => {
  const failing = table('create')
  await expect(failing.run(input('current'), undefined, 'Hi')).rejects.toThrow('No such project')
  const { calls, run } = table()
  // A start the host would refuse is caught after the thread exists, and reported with it rather than lost.
  const result = await run(input('current'), undefined, 'x'.repeat(11))
  expect(result.session).toBeNull()
  expect(result.error).toBeTruthy()
  expect(calls).toEqual(['create'])
})
