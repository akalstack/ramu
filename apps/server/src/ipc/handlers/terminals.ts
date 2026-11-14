import { homedir } from 'node:os'
import { z } from 'zod'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

const dimension = z.number().int().min(2).max(1000)

/** Terminals (pty sessions). */
export const registerTerminalHandlers: RegisterHandlers = ({ workspace, terminals, agents, cwdOf }) => ({
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
  /**
   * Types a command into the workspace's newest shell that is not running anything, or a new one in its folder, and
   * returns that shell for the person to watch: Run on a command in a reply.
   */
  'term.run': {
    args: z.tuple([id, z.string().trim().min(1).max(20_000)]),
    run: (ctx: string, command: string) => {
      const idle = terminals
        .list(ctx)
        .filter((terminal) => !terminal.background && !terminal.exited)
        .reverse()
        .find((terminal) => !terminals.busy(terminal.id))
      const terminal = idle ?? terminals.open(ctx, null, workspace.agentScope(ctx).cwd, 120, 32)
      terminals.write(terminal.id, `${command.replace(/\r?\n/g, '\r')}\r`)
      return terminal
    },
  },
  'term.background.launch': {
    args: z.tuple([id, id.nullable(), z.string().min(1).max(4000)]),
    run: (taskId: string, repoId: string | null, command: string) =>
      terminals.launchBackground(
        taskId,
        repoId,
        repoId ? cwdOf(taskId, repoId) : workspace.agentScope(taskId).cwd,
        command,
      ),
  },
  'term.background.list': { args: z.tuple([id]), run: (taskId: string) => terminals.listBackground(taskId) },
  'term.background.inspect': {
    args: z.tuple([id, id]),
    run: (taskId: string, termId: string) => terminals.inspectBackground(taskId, termId),
  },
  'term.background.stop': {
    args: z.tuple([id, id, z.boolean().optional()]),
    run: (taskId: string, termId: string, force?: boolean) => {
      const terminal = terminals.stopBackground(taskId, termId, force ?? false, 'user')
      if (terminal.stoppedBy === 'user') agents.recordBackgroundTerminalStop(taskId, termId, terminal.command)
      return terminal
    },
  },
  'term.snapshot': {
    // A client may send an absent `since` as null (JSON has no undefined in arrays); both mean the whole held output.
    args: z.union([z.tuple([id]), z.tuple([id, z.number().int().min(0).nullable()])]),
    run: (termId: string, since?: number | null) => terminals.snapshot(termId, since ?? undefined),
  },
})
