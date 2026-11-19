import type { ForgeRepositorySummary } from '@ramu/shared/types'

/** `parent` joined with `name` the way the host writes its paths. */
export function childPath(parent: string, name: string): string {
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/'
  return parent.endsWith(separator) ? parent + name : parent + separator + name
}

/**
 * The address to clone `owner/repo` from: the one the host's account reports for it, or its plain HTTPS address on the
 * pull request's service host (`forge`, GitHub when it is missing or not a host name).
 */
export function repositoryCloneUrl(
  repository: string,
  found: readonly Pick<ForgeRepositorySummary, 'fullName' | 'cloneUrl'>[],
  forge?: string,
): string {
  const wanted = repository.toLowerCase()
  const listed = found.find((entry) => entry.fullName.toLowerCase() === wanted)?.cloneUrl
  if (listed) return listed
  const host = forge && /^[a-z0-9.-]+$/i.test(forge) ? forge : 'github.com'
  return `https://${host}/${repository}.git`
}
