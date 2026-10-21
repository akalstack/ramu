import type { RamuBridge } from '@ramu/shared/api'
import type { RepositoryBinding } from '@ramu/shared/types'
import { readSyncConfirmation } from '@ramu/shared/protectedBranch'
import { confirmProtectedSync } from './ProtectedSyncDialog'

type Repository = Pick<RepositoryBinding, 'repoId' | 'repoName'>
/** The host decides from freshly fetched state whether a push needs approval. Pull-only sync never prompts. */
export async function syncRepositories(invoke: RamuBridge['invoke'], taskId: string, repositories: Repository[]) {
  const guarded: { repository: Repository; approval: NonNullable<ReturnType<typeof readSyncConfirmation>> }[] = []
  const errors: string[] = []
  await Promise.all(
    repositories.map(async (repository) => {
      try {
        await invoke('git.sync', taskId, repository.repoId)
      } catch (error) {
        const approval = readSyncConfirmation(error)
        if (approval) guarded.push({ repository, approval })
        else errors.push(`${repository.repoName}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }),
  )
  if (guarded.length) {
    const approved = await confirmProtectedSync(
      guarded.map(({ repository, approval }) => ({
        repoName: repository.repoName,
        branch:
          approval.branch === approval.targetBranch ? approval.branch : `${approval.branch} → ${approval.targetBranch}`,
      })),
    )
    if (!approved) errors.push('Sync cancelled for protected branches. Nothing was pushed to them.')
    else {
      const results = await Promise.allSettled(
        guarded.map(({ repository, approval }) => invoke('git.sync', taskId, repository.repoId, approval)),
      )
      results.forEach((result, index) => {
        if (result.status === 'rejected')
          errors.push(`${guarded[index]!.repository.repoName}: ${String(result.reason)}`)
      })
    }
  }
  if (errors.length) throw new Error(errors.join('\n'))
}
