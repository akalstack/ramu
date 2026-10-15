import type { Layout } from 'react-resizable-panels'
import type { PullMode } from '@ramu/shared/types'

// The Git section can shrink to its heading; the repository list always keeps room above it.
export const GIT_COLLAPSED_HEIGHT = 36
export const SCM_MIN_HEIGHT = 160

export const defaultScmLayout = (): Layout => ({ repos: 60, git: 40 })

export const PULL_NAME: Record<PullMode, string> = { rebase: 'rebase', merge: 'merge', 'ff-only': 'fast-forward only' }

export const LETTER: Record<string, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  untracked: 'U',
  unmerged: '!',
}
