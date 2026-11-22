import { z } from 'zod'
import type { DeployStatus } from '@ramu/shared/types/deploy'
import { appVariables } from '../../workspace/deploy/appVariables'
import { latestDeployChecks } from '../../workspace/deploy/gitHostStatus'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

const liveAddress = z
  .string()
  .trim()
  .max(2000)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Give an http or https address.')

/**
 * A project's Live app sheet: the latest deploy as the Git host reports it, the live address watch, the production
 * database migrations run against, and an app published from this computer. Agents reach platforms through their
 * plugins or CLIs, so nothing here names one.
 */
export const registerDeployHandlers: RegisterHandlers = (ctx) => {
  const need = <T>(service: T | undefined): T => {
    if (!service) throw new Error('Update this host for deploys.')
    return service
  }
  // An app published from this computer gets only the saved variables its code reads, never every saved one.
  void ctx.localApps?.start(async (root) => {
    const names = new Set(await appVariables(root))
    let saved: Record<string, string> = {}
    try {
      const status = ctx.environment.status(true)
      if (status.state !== 'unavailable')
        saved = Object.fromEntries((status.values?.global ?? []).map((variable) => [variable.key, variable.value]))
    } catch {
      // A locked credential store starts the app without them.
    }
    return Object.fromEntries(Object.entries(saved).filter(([name]) => names.has(name)))
  })
  const administrate = () => {
    if (ctx.host.canAdministerIntegrations?.() !== true) throw new Error('Change this on the host running Ramu.')
  }
  const project = (projectId: string) => {
    const found = ctx.workspace.listProjects().find((entry) => entry.id === projectId)
    if (!found) throw new Error('That project is not on this host.')
    return found.id
  }
  const repositoryOf = (projectId: string, repoId: string) => {
    const repository = ctx.workspace.getRepository(repoId)
    if (repository.projectId !== project(projectId)) throw new Error('Choose a repository of this project.')
    return repository
  }
  return {
    'deploy.status': {
      args: z.tuple([id]),
      run: async (projectId: string): Promise<DeployStatus> => {
        const read = await Promise.all(
          ctx.workspace.listRepositories(projectId).map((repository) => latestDeployChecks(repository)),
        )
        return { repositories: read.filter((entry) => entry !== null) }
      },
    },
    'deploy.migrations': {
      args: z.tuple([id]),
      run: (projectId: string) => need(ctx.migrations).plan(project(projectId)),
    },
    /** Saves (or with null forgets) the production database address; write-only, never read back. */
    'deploy.setProductionDatabase': {
      args: z.tuple([id, z.string().trim().url().max(2000).nullable()]),
      run: (projectId: string, address: string | null) => {
        administrate()
        const migrations = need(ctx.migrations)
        return address ? migrations.save(project(projectId), address) : migrations.remove(project(projectId))
      },
    },
    'deploy.uptime': {
      args: z.tuple([id]),
      run: (projectId: string) => need(ctx.uptime).status(project(projectId)),
    },
    'deploy.setUptime': {
      args: z.tuple([id, z.boolean()]),
      run: (projectId: string, enabled: boolean) => need(ctx.uptime).setEnabled(project(projectId), enabled),
    },
    'deploy.setLiveAddress': {
      args: z.tuple([id, liveAddress.nullable()]),
      run: (projectId: string, address: string | null) => need(ctx.uptime).setAddress(project(projectId), address),
    },
    'deploy.localStatus': {
      args: z.tuple([id]),
      run: (projectId: string) => need(ctx.localApps).status(project(projectId)),
    },
    'deploy.localPublish': {
      args: z.tuple([id, id, z.enum(['container', 'process']).optional()]),
      run: (projectId: string, repoId: string, mode?: 'container' | 'process') =>
        need(ctx.localApps).publish(project(projectId), repositoryOf(projectId, repoId).root, mode),
    },
    'deploy.localAddress': {
      args: z.tuple([id, z.string().trim().min(3).max(253), z.string().trim().min(20).max(400)]),
      run: (projectId: string, hostname: string, token: string) => {
        administrate()
        return need(ctx.localApps).setLasting(project(projectId), { hostname, token })
      },
    },
    'deploy.removeLocalAddress': {
      args: z.tuple([id]),
      run: (projectId: string) => {
        administrate()
        return need(ctx.localApps).removeLasting(project(projectId))
      },
    },
    'deploy.localStop': {
      args: z.tuple([id]),
      run: (projectId: string) => need(ctx.localApps).stop(project(projectId)),
    },
  }
}
