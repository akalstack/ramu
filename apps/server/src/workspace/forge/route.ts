// Picks the adapter for a checkout from its publish remote, so callers never branch on the hosting service.
import { forgeKind, type ForgeKind } from '@ramu/shared/forgeHosts'
import { forgeAdapter, type ForgeAdapter } from './adapter'
import { forgeRemoteOf } from './github'
import { gitlabProjectOf, knownGitlabHosts } from './gitlab'

const UNSUPPORTED: Partial<Record<ForgeKind, string>> = {
  bitbucket: 'Bitbucket',
  azure: 'Azure DevOps',
}

/** The service an origin belongs to, recognising self-managed GitLab servers the person has signed in to. */
export async function kindOfOrigin(origin: string): Promise<ForgeKind> {
  return forgeKind(origin, await knownGitlabHosts())
}

/** A recognised hosting service Ramu has no adapter for. */
export class UnsupportedForgeError extends Error {}

/** The adapter for one origin; a recognised service without an adapter says so instead of trying GitHub. */
export async function adapterForOrigin(origin: string | undefined): Promise<ForgeAdapter> {
  const kind = origin ? await kindOfOrigin(origin) : 'github'
  if (kind === 'github' || kind === 'gitlab') return forgeAdapter(kind)
  throw new UnsupportedForgeError(`${UNSUPPORTED[kind]} repositories are not supported yet; use Git directly for them.`)
}

/** The adapter for a checkout, from its publish remote. A checkout without a remote keeps GitHub's answers. */
export async function adapterFor(cwd: string): Promise<ForgeAdapter> {
  const remote = (await forgeRemoteOf(cwd)) ?? (await gitlabProjectOf(cwd))
  return adapterForOrigin(remote?.origin)
}
