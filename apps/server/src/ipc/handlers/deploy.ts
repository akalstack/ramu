import { z } from 'zod'
import { HOSTING_PLATFORMS, type HostingPlatform } from '@ramu/shared/types/deploy'
import { platformCli } from '../../workspace/deploy/signIn'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

const platform = z.enum(HOSTING_PLATFORMS)
const signIn = z.string().uuid()
const deploymentId = z.string().trim().min(1).max(200)

/** A platform project name from the Ramu project's name: lowercase letters, digits and dashes. */
const siteName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'ramu-app'

/** Hosting accounts and project deploys. Tokens change only on the host itself; actions check the project's binding. */
export const registerDeployHandlers: RegisterHandlers = (ctx) => {
  const deploys = () => {
    if (!ctx.deploys) throw new Error('Update this host for deploys.')
    return ctx.deploys
  }
  const administrator = () => ctx.host.canAdministerIntegrations?.() === true
  const administrate = () => {
    if (!administrator()) throw new Error('Connect hosting accounts on the host running Ramu.')
  }
  const summary = async (check: boolean) => ({
    accounts: await deploys().accounts.list(check, (name) => !!platformCli(name)),
    canAdminister: administrator(),
  })
  // Deploy actions on one project run one at a time, so two clicks never start two deploys.
  const exclusive = <T>(projectId: string, work: () => Promise<T>) => ctx.lock.run(`deploy:${projectId}`, work)
  const known = (projectId: string) => {
    const found = ctx.workspace.listProjects().find((entry) => entry.id === projectId)
    if (!found) throw new Error('That project is not on this host.')
    return found
  }
  const project = (projectId: string) => known(projectId).id
  return {
    'deploy.accounts': { args: z.tuple([z.boolean()]), run: (check: boolean) => summary(check) },
    'deploy.signIn': {
      args: z.tuple([platform]),
      run: (name: HostingPlatform) => {
        administrate()
        return deploys().signIns.start(name)
      },
    },
    'deploy.signInStatus': { args: z.tuple([signIn]), run: (signInId: string) => deploys().signIns.status(signInId) },
    'deploy.cancelSignIn': { args: z.tuple([signIn]), run: (signInId: string) => deploys().signIns.cancel(signInId) },
    'deploy.saveToken': {
      args: z.tuple([platform, z.string().trim().min(8).max(4000).regex(/^\S+$/, 'Paste the token alone')]),
      run: (name: HostingPlatform, token: string) => {
        administrate()
        return deploys().accounts.save(name, { token }, 'token')
      },
    },
    'deploy.disconnect': {
      args: z.tuple([platform]),
      run: async (name: HostingPlatform) => {
        administrate()
        await deploys().accounts.disconnect(name)
        return summary(false)
      },
    },
    'deploy.project': {
      args: z.tuple([id]),
      run: (projectId: string) => deploys().service.project(project(projectId)),
    },
    'deploy.link': {
      args: z.tuple([id, platform, id]),
      run: (projectId: string, name: HostingPlatform, repoId: string) =>
        exclusive(projectId, () =>
          deploys().service.link(project(projectId), name, repoId, siteName(known(projectId).name)),
        ),
    },
    'deploy.production': {
      args: z.tuple([id]),
      run: (projectId: string) => exclusive(projectId, () => deploys().service.deploy(project(projectId), null, true)),
    },
    'deploy.logs': {
      args: z.tuple([id, deploymentId]),
      run: (projectId: string, deployment: string) => deploys().service.logs(project(projectId), deployment),
    },
    'deploy.rollback': {
      args: z.tuple([id, deploymentId]),
      run: (projectId: string, deployment: string) =>
        exclusive(projectId, () => deploys().service.rollback(project(projectId), deployment)),
    },
  }
}
