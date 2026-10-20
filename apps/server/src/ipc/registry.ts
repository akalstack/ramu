import { z } from 'zod'
import { mergeMethods } from './helpers'
import { registerAgentHandlers } from './handlers/agent'
import { registerAsideHandlers } from './handlers/aside'
import { registerThemeHandlers } from './handlers/theme'
import { registerBackgroundHandlers } from './handlers/background'
import { registerFileHandlers } from './handlers/files'
import { registerForgeHandlers } from './handlers/forge'
import { registerGitHandlers } from './handlers/git'
import { registerMemoryHandlers } from './handlers/memory'
import { registerProviderHandlers } from './handlers/providers'
import { registerSharedMcpHandlers } from './handlers/mcp'
import { registerProjectSetupHandlers } from './handlers/projectSetup'
import { registerReviewHandlers } from './handlers/reviews'
import { registerScheduleHandlers } from './handlers/schedules'
import { registerSearchHandlers } from './handlers/search'
import { registerSettingsHandlers } from './handlers/settings'
import { registerSummaryHandlers } from './handlers/summaries'
import { registerTerminalHandlers } from './handlers/terminals'
import { registerUiHandlers } from './handlers/ui'
import { registerWorkspaceHandlers } from './handlers/workspace'
import type { HandlerContext, MethodTable } from './types'

/** The renderer's method table: every handler group, merged. Method names are unique across groups. */
export const registerHandlers = (ctx: HandlerContext): MethodTable =>
  mergeMethods(
    {
      'interactive.get': {
        args: z.tuple([z.string().min(1).max(200), z.string().uuid(), z.number().int().positive()]),
        run: (session: string, id: string, version: number) => {
          if (!ctx.interactive) throw new Error('Update this host for Interactive Content')
          return ctx.interactive.get(session, id, version)
        },
      },
      'interactive.list': {
        args: z.tuple([z.string().min(1).max(200)]),
        run: (session: string) => ctx.interactive?.list(session) ?? [],
      },
    },
    registerWorkspaceHandlers(ctx),
    registerAgentHandlers(ctx),
    registerAsideHandlers(ctx),
    registerThemeHandlers(ctx),
    registerGitHandlers(ctx),
    registerForgeHandlers(ctx),
    registerFileHandlers(ctx),
    registerSearchHandlers(ctx),
    registerReviewHandlers(ctx),
    registerTerminalHandlers(ctx),
    registerMemoryHandlers(ctx),
    registerSummaryHandlers(ctx),
    registerSettingsHandlers(ctx),
    registerProviderHandlers(ctx),
    registerSharedMcpHandlers(ctx),
    registerProjectSetupHandlers(ctx),
    registerUiHandlers(ctx),
    registerBackgroundHandlers(ctx),
    registerScheduleHandlers(ctx),
  )
