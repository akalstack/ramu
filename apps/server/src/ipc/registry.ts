import { z } from 'zod'
import { mergeMethods } from './helpers'
import { registerAgentHandlers } from './handlers/agent'
import { registerAsideHandlers } from './handlers/aside'
import { registerThemeHandlers } from './handlers/theme'
import { registerBackgroundHandlers } from './handlers/background'
import { registerBrowserActivityHandlers } from './handlers/browserActivity'
import { registerComputerHandlers } from './handlers/computer'
import { registerHostBrowserHandlers } from './handlers/hostBrowser'
import { registerFileHandlers } from './handlers/files'
import { registerForgeHandlers } from './handlers/forge'
import { registerDeployHandlers } from './handlers/deploy'
import { registerCiHandlers } from './handlers/ci'
import { registerGitHandlers } from './handlers/git'
import { registerMemoryHandlers } from './handlers/memory'
import { registerPluginHandlers } from './handlers/plugins'
import { registerIdentityHandlers } from './handlers/identities'
import { registerSettingsTransferHandlers } from './handlers/settingsTransfer'
import { registerToolSyncHandlers } from './handlers/toolSync'
import { registerToolAuditHandlers } from './handlers/toolAudit'
import { registerAccountHandlers } from './handlers/account'
import { registerProviderHandlers } from './handlers/providers'
import { registerSharedMcpHandlers } from './handlers/mcp'
import { registerProjectSetupHandlers } from './handlers/projectSetup'
import { registerReviewHandlers } from './handlers/reviews'
import { registerScheduleHandlers } from './handlers/schedules'
import { registerArtifactHandlers } from './handlers/artifacts'
import { registerSearchHandlers } from './handlers/search'
import { registerSettingsHandlers } from './handlers/settings'
import { registerRuleHandlers } from './handlers/rules'
import { registerSummaryHandlers } from './handlers/summaries'
import { registerTerminalHandlers } from './handlers/terminals'
import { registerUiHandlers } from './handlers/ui'
import { registerThreadStartHandlers } from './handlers/threadStart'
import { registerWorkspaceHandlers } from './handlers/workspace'
import type { HandlerContext, MethodTable } from './types'
import { HOST_EXPORT_FORMATS, type HostExportFormat } from '@ramu/shared/interactiveExport'
import { withoutAssetBytes } from '@ramu/shared/interactive'

/** The renderer's method table: every handler group, merged. Method names are unique across groups. */
export const registerHandlers = (ctx: HandlerContext): MethodTable => {
  const base = mergeMethods(
    {
      'interactive.get': {
        args: z.tuple([z.string().min(1).max(200), z.string().uuid(), z.number().int().positive()]),
        run: (session: string, id: string, version: number) => {
          if (!ctx.interactive) throw new Error('Update this host for Interactive Content')
          // The page carries an App's assets; its file list names them without a second copy of their bytes.
          const document = withoutAssetBytes(ctx.interactive.get(session, id, version))
          if (!ctx.liveDashboards || document.reference.kind !== 'dashboard') return document
          // A card in a thread reads its dashboard's live tables from the thread's project.
          let projectId: string | null = null
          try {
            projectId = ctx.workspace.getTask(ctx.agents.get(session).taskId).projectId
          } catch {
            // A thread no longer in a project shows the dashboard as published.
          }
          return ctx.liveDashboards.serve(document, projectId)
        },
      },
      'interactive.list': {
        args: z.tuple([z.string().min(1).max(200)]),
        run: (session: string) => ctx.interactive?.list(session) ?? [],
      },
      'interactive.media': {
        args: z.tuple([z.string().min(1).max(200), z.string().uuid(), z.number().int().positive()]),
        run: (session: string, id: string, version: number) => {
          if (!ctx.interactive) throw new Error('Update this host for Interactive Content')
          // Reading the version first keeps another thread's media out of reach.
          ctx.interactive.get(session, id, version)
          const { wide, light } = ctx.interactive.media(id, version)
          return { wide, light }
        },
      },
      'interactive.export': {
        args: z.tuple([
          z.string().min(1).max(200),
          z.string().uuid(),
          z.number().int().positive(),
          z.enum(HOST_EXPORT_FORMATS),
        ]),
        run: (session: string, id: string, version: number, format: HostExportFormat) => {
          if (!ctx.interactive || !ctx.artifactExports) throw new Error('Update this host for exports.')
          return ctx.artifactExports.make(ctx.interactive.get(session, id, version), format)
        },
      },
      'interactive.restore': {
        args: z.tuple([z.string().min(1).max(200), z.string().uuid(), z.number().int().positive()]),
        run: (session: string, id: string, version: number) => {
          if (!ctx.interactive) throw new Error('Update this host for Interactive Content')
          return ctx.interactive.restore(session, id, version)
        },
      },
    },
    registerWorkspaceHandlers(ctx),
    registerAgentHandlers(ctx),
    registerAsideHandlers(ctx),
    registerThemeHandlers(ctx),
    registerGitHandlers(ctx),
    registerForgeHandlers(ctx),
    registerDeployHandlers(ctx),
    registerCiHandlers(ctx),
    registerFileHandlers(ctx),
    registerSearchHandlers(ctx),
    registerReviewHandlers(ctx),
    registerTerminalHandlers(ctx),
    registerMemoryHandlers(ctx),
    registerPluginHandlers(ctx),
    registerIdentityHandlers(ctx),
    registerSettingsTransferHandlers(ctx),
    registerToolSyncHandlers(ctx),
    registerToolAuditHandlers(ctx),
    registerAccountHandlers(ctx),
    registerSummaryHandlers(ctx),
    registerRuleHandlers(ctx),
    registerSettingsHandlers(ctx),
    registerProviderHandlers(ctx),
    registerSharedMcpHandlers(ctx),
    registerProjectSetupHandlers(ctx),
    registerUiHandlers(ctx),
    registerBackgroundHandlers(ctx),
    registerBrowserActivityHandlers(ctx),
    registerHostBrowserHandlers(ctx),
    registerComputerHandlers(ctx),
    registerScheduleHandlers(ctx),
    registerArtifactHandlers(ctx),
  )
  // Composed from the methods above, so it runs them exactly as they run on their own.
  return mergeMethods(base, registerThreadStartHandlers(base))
}
