import { z } from 'zod'
import {
  SEARCH_RESULT_LIMIT,
  REPLACE_MATCH_LIMIT,
  REPLACE_FILE_LIMIT,
  REPLACE_CONTENT_LIMIT,
} from '@ramu/shared/searchLimits'
import type { ReplaceFilePreview, SearchOptions, SearchMatch } from '@ramu/shared/types'
import * as files from '../../workspace/files'
import { lockCheckouts } from '../helpers'
import { id, relPath } from '../schemas'
import type { HandlerContext, RegisterHandlers } from '../types'

const searchOptions = z.object({
  query: z.string().min(1).max(1000),
  caseSensitive: z.boolean(),
  wholeWord: z.boolean(),
  regex: z.boolean(),
  include: z.string().max(2000),
  exclude: z.string().max(2000),
  repoId: id.optional(),
})
const replacePreview = z
  .array(
    z.object({
      repoId: id,
      path: relPath,
      hash: z.string().regex(/^[a-f0-9]{64}$/),
      count: z.number().int().positive(),
      before: z.string().max(160),
      after: z.string().max(160),
    }),
  )
  .max(REPLACE_FILE_LIMIT)

const replacementPlans = async (
  { workspace, cwdOf }: HandlerContext,
  taskId: string,
  options: SearchOptions,
  replacement: string,
) => {
  const plans: Awaited<ReturnType<typeof files.replacementPlan>> = []
  let count = 0
  for (const binding of workspace.fileBindings(taskId)) {
    if (binding.setupState !== 'ready' || (options.repoId && options.repoId !== binding.repoId)) continue
    const found = await files.searchText(
      cwdOf(taskId, binding.repoId),
      binding.repoId,
      options,
      REPLACE_MATCH_LIMIT - count,
    )
    count += found.matches.length
    if (found.limited)
      throw new Error(
        `Replacement exceeds ${REPLACE_MATCH_LIMIT.toLocaleString('en-US')} matches. Narrow the search using the include/exclude filters.`,
      )
    if (plans.length + new Set(found.matches.map((match) => match.path)).size > REPLACE_FILE_LIMIT)
      throw new Error(
        `Replacement exceeds ${REPLACE_FILE_LIMIT.toLocaleString('en-US')} files. Narrow the include filter or repository.`,
      )
    plans.push(
      ...(await files.replacementPlan(
        cwdOf(taskId, binding.repoId),
        binding.repoId,
        options,
        replacement,
        found.matches,
      )),
    )
    if (
      plans.length > REPLACE_FILE_LIMIT ||
      plans.reduce((bytes, plan) => bytes + Buffer.byteLength(plan.content), 0) > REPLACE_CONTENT_LIMIT
    )
      throw new Error('Replacement spans too many files or too much content. Narrow the include filter or repository.')
  }
  return plans
}

/** Project-wide text search and replace. */
export const registerSearchHandlers: RegisterHandlers = (ctx) => {
  const { workspace, cwdOf } = ctx
  return {
    'files.replacePreview': {
      args: z.tuple([id, searchOptions, z.string().max(100_000)]),
      run: async (t: string, options: SearchOptions, replacement: string) =>
        (await replacementPlans(ctx, t, options, replacement)).map((plan) => plan.preview),
    },
    'files.replaceApply': {
      args: z.tuple([id, searchOptions, z.string().max(100_000), replacePreview]),
      run: (t: string, options: SearchOptions, replacement: string, expected: ReplaceFilePreview[]) =>
        lockCheckouts(
          ctx,
          workspace
            .fileBindings(t)
            .filter((binding) => binding.setupState === 'ready')
            .map((binding) => binding.cwd),
          async () => {
            const plans = await replacementPlans(ctx, t, options, replacement)
            if (
              plans.length !== expected.length ||
              plans.some(
                ({ preview }) =>
                  !expected.some(
                    (file) =>
                      file.repoId === preview.repoId &&
                      file.path === preview.path &&
                      file.hash === preview.hash &&
                      file.count === preview.count &&
                      file.before === preview.before &&
                      file.after === preview.after,
                  ),
              )
            )
              throw new Error('Search results or files changed. Review replacement again.')
            for (const { preview } of plans)
              if ((await files.readText(cwdOf(t, preview.repoId), preview.path)).hash !== preview.hash)
                throw new Error('Files changed. Review replacement again.')
            let saved = 0
            for (const { preview, content } of plans) {
              try {
                const result = await files.writeText(cwdOf(t, preview.repoId), preview.path, content, preview.hash)
                if (!result.ok) throw new Error('File changed on disk.')
                saved++
              } catch (error) {
                throw new Error(
                  `Replacement stopped at ${preview.path}. ${saved} files were saved; refresh and review the remaining files. ${error instanceof Error ? error.message : String(error)}`,
                )
              }
            }
          },
        ),
    },
    'files.search': {
      args: z.tuple([id, searchOptions]),
      run: async (taskId: string, options: SearchOptions) => {
        const matches: SearchMatch[] = []
        let limited = false
        for (const binding of workspace.fileBindings(taskId)) {
          if (binding.setupState !== 'ready' || (options.repoId && binding.repoId !== options.repoId)) continue
          const result = await files.searchText(
            cwdOf(taskId, binding.repoId),
            binding.repoId,
            options,
            SEARCH_RESULT_LIMIT - matches.length,
          )
          matches.push(...result.matches)
          if (result.limited) {
            limited = true
            break
          }
        }
        return { matches, limited }
      },
    },
  }
}
