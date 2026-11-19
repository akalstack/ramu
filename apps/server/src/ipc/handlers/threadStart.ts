import { z } from 'zod'
import type { MethodTable } from '../types'

/**
 * Creates a thread and starts its agent in one call: `tasks.create`, then `tasks.setup` for a worktree, then
 * `agent.start`, each exactly as the separate methods run them (same validation, locks and errors). A phone on a slow
 * link pays one round trip instead of three or four.
 *
 * A failure after the thread exists is returned, not thrown, with the thread: the caller keeps it (and its worktree)
 * to review or retry, as it did when the steps were separate calls. A retry under the same `requestId` finds the same
 * thread, and the call is keyed by `operationKey` like `tasks.create` and `agent.start`.
 */
export function registerThreadStartHandlers(table: MethodTable): MethodTable {
  const part = (name: string) => {
    const method = table[name]
    if (!method) throw new Error(`Missing RPC method ${name}`)
    return method
  }
  return {
    'thread.start': {
      args: z.tuple([
        z.object({ mode: z.enum(['current', 'worktree']) }).passthrough(),
        z.unknown().optional(),
        z.unknown(),
        z.unknown().optional(),
        z.unknown().optional(),
        z.unknown().optional(),
      ]),
      run: async (input: { mode: 'current' | 'worktree' }, plan: unknown, ...start: unknown[]) => {
        const created = part('tasks.create')
        const task = (await created.run(...created.args.parse([input, plan]))) as { id: string }
        try {
          if (input.mode === 'worktree') await part('tasks.setup').run(task.id)
          const begin = part('agent.start')
          const session = await begin.run(...begin.args.parse([task.id, ...start]))
          return { task, session }
        } catch (error) {
          return { task, session: null, error: error instanceof Error ? error.message : String(error) }
        }
      },
    },
  }
}
