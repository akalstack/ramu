import { z } from 'zod'
import { FINISH_LINES, type FinishLine } from '@ramu/shared/ship'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** A project's finish line for Ship, kept on the host; the repository's committed `ramu.json` can only lower it. */
export const registerShipHandlers: RegisterHandlers = (ctx) => {
  const ship = () => {
    if (!ctx.ship) throw new Error('Update this host to ship.')
    return ctx.ship
  }
  const project = (projectId: string) => {
    if (!ctx.workspace.listProjects().some((entry) => entry.id === projectId))
      throw new Error('That project is not on this host.')
    return projectId
  }
  return {
    'ship.activity': {
      args: z.tuple([]),
      run: () => ship().activity(),
    },
    'ship.undo': {
      args: z.tuple([z.string().uuid()]),
      run: (activityId: string) => ship().undo(activityId),
    },
    'ship.project': {
      args: z.tuple([id]),
      run: (projectId: string) => ship().projectStatus(project(projectId)),
    },
    'ship.setFinishLine': {
      args: z.tuple([id, z.enum(FINISH_LINES).nullable()]),
      run: (projectId: string, finishLine: FinishLine | null) => {
        ship().setProjectFinishLine(project(projectId), finishLine)
        return ship().projectStatus(projectId)
      },
    },
  }
}
