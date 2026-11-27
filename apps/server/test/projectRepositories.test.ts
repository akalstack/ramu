import { expect, it } from 'vitest'
import type { Project, Repository } from '@ramu/shared/types'
import { ProjectRepositories } from '../src/workspace/projectRepositories'

const project = (id: string): Project => ({ id, name: id, root: `/work/${id}`, createdAt: 0 })
const repo = (projectId: string, root: string): Repository => ({ id: root, projectId, name: root, root })

it('says which repository a project is a checkout of, and nothing for one without a remote', async () => {
  const remotes: Record<string, string> = {
    '/work/app': 'git@github.com:Acme/App.git',
    '/work/api': 'https://github.com/acme/api',
    '/work/web': 'https://github.com/acme/web.git',
  }
  let reads = 0
  let now = 0
  const repositories = new ProjectRepositories(
    (projectId) =>
      ({
        app: [repo('app', '/work/app')],
        mono: [repo('mono', '/work/web'), repo('mono', '/work/api')],
        local: [repo('local', '/work/local')],
        mixed: [repo('mixed', '/work/app'), repo('mixed', '/work/local')],
        empty: [],
      })[projectId] ?? [],
    async (root) => {
      reads++
      if (!remotes[root]) throw new Error('No such remote')
      return remotes[root]
    },
    () => now,
  )
  const list = ['app', 'mono', 'local', 'mixed', 'empty'].map(project)
  expect((await repositories.label(list)).map((entry) => entry.repository)).toEqual([
    'github.com/acme/app',
    // Several repositories: all of them, in one order whatever order they were added in.
    'github.com/acme/api+github.com/acme/web',
    undefined,
    // Only partly the same repository is not the same project.
    undefined,
    undefined,
  ])
  // The list is read often; a remote is not read again while it is fresh.
  const first = reads
  await repositories.label(list)
  expect(reads).toBe(first)
  now = 11 * 60_000
  remotes['/work/app'] = 'git@github.com:acme/renamed.git'
  expect((await repositories.label([project('app')]))[0]?.repository).toBe('github.com/acme/renamed')
})
