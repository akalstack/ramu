import { homedir } from 'node:os'
import { z } from 'zod'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

const dimension = z.number().int().min(2).max(1000)

/** Terminals (pty sessions). */
export const registerTerminalHandlers: RegisterHandlers = ({ workspace, terminals, cwdOf }) => ({
  'term.open': {
    args: z.tuple([id, id.nullable(), dimension, dimension]),
    run: (taskId: string, repoId: string | null, cols: number, rows: number) =>
      terminals.open(taskId, repoId, repoId ? cwdOf(taskId, repoId) : workspace.agentScope(taskId).cwd, cols, rows),
  },
  'term.openSetup': {
    args: z.tuple([dimension, dimension]),
    run: (cols: number, rows: number) => terminals.open('provider-setup', null, homedir(), cols, rows),
  },
  'term.write': {
    args: z.tuple([id, z.string().max(1_000_000)]),
    run: (t: string, d: string) => terminals.write(t, d),
  },
  'term.resize': {
    args: z.tuple([id, dimension, dimension]),
    run: (t: string, c: number, r: number) => terminals.resize(t, c, r),
  },
  'term.close': { args: z.tuple([id]), run: (t: string) => terminals.close(t) },
  'term.busy': {
    args: z.tuple([z.array(id).max(200)]),
    run: (ids: string[]) => ids.filter((t) => terminals.busy(t)).length,
  },
  'term.list': { args: z.tuple([id]), run: (taskId: string) => terminals.list(taskId) },
  'term.snapshot': { args: z.tuple([id]), run: (termId: string) => terminals.snapshot(termId) },
})
