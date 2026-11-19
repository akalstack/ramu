import { sep } from 'node:path'

/**
 * Whether a session reaches `path`: a covered folder also covers the repositories inside it,
 * including ones added to the project after the session started (such as a repository cloned into it).
 */
export function coversPath(covers: readonly string[], path: string): boolean {
  return covers.some((root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep))
}
