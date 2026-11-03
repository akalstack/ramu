// Picks the adapter for a checkout from its publish remote, so callers never branch on the hosting service.
import { forgeKind, type ForgeKind } from '@ramu/shared/forgeHosts'
import { forgeAdapter, type ForgeAdapter } from './adapter'
import { forgeRemoteOf } from './github'
import { gitlabProjectOf, knownGitlabHosts } from './gitlab'
import { bitbucketRepositoryOf } from './bitbucket'
import { azureRepositoryOf } from './azure'

/** The service an origin belongs to, recognising self-managed GitLab servers the person has signed in to. */
export async function kindOfOrigin(origin: string): Promise<ForgeKind> {
  return forgeKind(origin, await knownGitlabHosts())
}

/** The adapter for one origin. Every recognised service has one; anything else keeps GitHub's answers. */
export async function adapterForOrigin(origin: string | undefined): Promise<ForgeAdapter> {
  return forgeAdapter(origin ? await kindOfOrigin(origin) : 'github')
}

/** The adapter for a checkout, from its publish remote. A checkout without a remote keeps GitHub's answers. */
export async function adapterFor(cwd: string): Promise<ForgeAdapter> {
  const remote =
    (await forgeRemoteOf(cwd)) ??
    (await gitlabProjectOf(cwd)) ??
    ((await bitbucketRepositoryOf(cwd)) ? { origin: 'bitbucket.org' } : null) ??
    ((await azureRepositoryOf(cwd)) ? { origin: 'dev.azure.com' } : null)
  return adapterForOrigin(remote?.origin)
}
