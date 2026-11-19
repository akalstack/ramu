import type { RepositoryBinding } from '@ramu/shared/types'
import { ipcQueryKeyOn } from '../dataQueries'

/** Git reads belong to the checkout, even when another thread or popover requests them. */
export function repositoryQueryKey(
  host: string,
  method: 'git.status' | 'git.branches' | 'git.history' | 'git.stashes' | 'git.lineStats',
  binding?: Pick<RepositoryBinding, 'repoId' | 'cwd'>,
) {
  return ipcQueryKeyOn(host, method, 'checkout', binding?.repoId ?? null, binding?.cwd ?? null)
}
