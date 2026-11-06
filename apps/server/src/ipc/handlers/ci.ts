import { z } from 'zod'
import { ciPreview, setUpCi } from '../../workspace/ci/setup'
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
      run: (projectId: string, repoId: string) => ciPreview(rootOf(projectId, repoId)),
    },
    'ci.setup': {
      args: z.tuple([id, id]),
      // One setup per repository at a time, so two clicks never open two pull requests.
      run: (projectId: string, repoId: string) =>
        ctx.lock.run(`ci:${repoId}`, async () => {
          const result = await setUpCi(rootOf(projectId, repoId))
          ctx.pullRequestIndex?.invalidate(repoId)
          return result
        }),
    },
  }
}
