import { Alert } from 'react-native'
import type { AppPreferences, CommitBranchOptions } from '@ramu/shared/types'
import { commitBranchOptions, commitBranchQuestion } from './commitBranch'
import type { useStore } from './store'

type Invoke = ReturnType<typeof useStore>['invoke']
type Say = (text: string, params?: Record<string, string | number>) => string

/**
 * Where a Commit & Push or Commit & Sync goes: on the default branch, the person picks a feature branch or this one, as on
 * the desktop. Null when they cancel; otherwise the options for `git.commit`.
 */
export async function chooseCommitBranch(
  invoke: Invoke,
  target: { computerId: string; taskId: string; repoId: string },
  action: 'push' | 'sync',
  preference: AppPreferences['defaultCommitBranch'] | undefined,
  say: Say,
): Promise<CommitBranchOptions | null> {
  const info = await invoke(target.computerId, 'git.commitBranchInfo', target.taskId, target.repoId)
  const question = commitBranchQuestion(action, info, preference)
  if (!question) return { expectedBranch: info.branch }
  const choice = await new Promise<'new' | 'current' | null>((resolve) => {
    const feature = { text: say('Create feature branch'), onPress: () => resolve('new') }
    const current = { text: say('Continue on {0}', { 0: question.branch }), onPress: () => resolve('current') }
    Alert.alert(
      say(action === 'sync' ? 'Commit & Sync to default branch?' : 'Commit & Push to default branch?'),
      `${say('You are on {0}. Continue on this branch or create a feature branch before you commit and push.', {
        0: question.branch,
      })}\n\n${say('The feature branch is named from your changes. Staged and unstaged changes are kept, and you stay on it.')}`,
      [
        ...(question.first === 'new' ? [feature, current] : [current, feature]),
        { text: say('Cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    )
  })
  return choice ? commitBranchOptions(question.branch, choice) : null
}
