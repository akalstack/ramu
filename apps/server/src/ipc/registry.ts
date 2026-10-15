import { mergeMethods } from './helpers'
import { registerAgentHandlers } from './handlers/agent'
import { registerAsideHandlers } from './handlers/aside'
import { registerBackgroundHandlers } from './handlers/background'
import { registerFileHandlers } from './handlers/files'
import { registerForgeHandlers } from './handlers/forge'
import { registerGitHandlers } from './handlers/git'
import { registerMemoryHandlers } from './handlers/memory'
import { registerProviderHandlers } from './handlers/providers'
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
    registerWorkspaceHandlers(ctx),
    registerAgentHandlers(ctx),
    registerAsideHandlers(ctx),
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
    registerUiHandlers(ctx),
    registerBackgroundHandlers(ctx),
    registerScheduleHandlers(ctx),
  )
