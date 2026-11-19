import { z } from 'zod'
import { CREATED_REPOSITORIES, ciPreview, setUpCi } from '../../workspace/ci/setup'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** Set up CI for a repository of a project. The change always arrives as a pull request the person reviews. */
export const registerCiHandlers: RegisterHandlers = (ctx) => {
  const rootOf = (projectId: string, repoId: string) => {
    const repository = ctx.workspace.getRepository(repoId)
    if (repository.projectId !== projectId) throw new Error('Choose a repository of this project.')
    return repository.root
  }
  return {
    'ci.preview': {
      args: z.tuple([id, id]),
      run: async (projectId: string, repoId: string) => {
        const preview = await ciPreview(rootOf(projectId, repoId))
        const created = ctx.workspace.getAppState<string[]>(CREATED_REPOSITORIES, []).includes(repoId)
        return { ...preview, requireByDefault: created && (preview.forge === 'github' || preview.forge === 'gitlab') }
      },
    },
    'ci.setup': {
      args: z.tuple([id, id, z.boolean()]),
      // One setup per repository at a time, so two clicks never open two pull requests.
      run: (projectId: string, repoId: string, requireCi: boolean) =>
        ctx.lock.run(`ci:${repoId}`, async () => {
          const result = await setUpCi(rootOf(projectId, repoId), requireCi)
          ctx.pullRequestIndex?.invalidate(repoId)
          return result
        }),
    },
  }
}
