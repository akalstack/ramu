import type { CommitAction } from '@ramu/shared/types'
import { t } from '../../i18n'

export const commitActionLabel = (action: CommitAction) =>
  t(action === 'push' ? 'Commit & Push' : action === 'sync' ? 'Commit & Sync' : 'Commit')
