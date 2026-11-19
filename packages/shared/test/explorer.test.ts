import { expect, it } from 'vitest'
import {
  explorerKey,
  flattenExplorer,
  searchExplorerFiles,
  projectExplorerContext,
  projectWorkspaces,
} from '../src/workspace/explorer'
it('qualifies identity by host, checkout, repository and path without delimiter collisions', () => {
  expect(explorerKey('a', 'project:p', 'r', 'x')).not.toBe(explorerKey('b', 'project:p', 'r', 'x'))
  expect(explorerKey('a', 'worktree:w', 'r', 'x')).not.toBe(explorerKey('a', 'project:p', 'r', 'x'))
  expect(() => projectExplorerContext('a', 'b:p')).toThrow(/another host/)
  expect(projectExplorerContext('a', 'a:p')).toBe('project:p')
})
it('shows only expanded directories, sorts folders first and keeps identical names in different repos distinct', () => {
  const dirs = {
    '': [
      { name: 'z', path: 'z', kind: 'file' as const },
      { name: 'a', path: 'a', kind: 'dir' as const },
    ],
    a: [{ name: 'x', path: 'a/x', kind: 'file' as const }],
  }
  expect(flattenExplorer('r', dirs, new Set()).map((x) => x.entry.path)).toEqual(['a', 'z'])
  expect(flattenExplorer('r', dirs, new Set(['r:a'])).map((x) => [x.entry.path, x.depth])).toEqual([
    ['a', 0],
    ['a/x', 1],
    ['z', 0],
  ])
  expect(flattenExplorer('other', dirs, new Set(['r:a'])).map((x) => x.entry.path)).toEqual(['a', 'z'])
})

it('selects existing workspaces only from the owning host and exact project catalog', () => {
  const rows = [
    { id: 'w', projectId: 'p', name: 'Login', createdAt: 1 },
    { id: 'other', projectId: 'different', name: 'Login', createdAt: 1 },
  ]
  expect(projectWorkspaces('host', 'host:p', rows)).toEqual([rows[0]])
  expect(projectWorkspaces('host', 'host:gone', rows)).toEqual([])
  expect(() => projectWorkspaces('other-host', 'host:p', rows)).toThrow(/another host/)
})

it('finds only strict relative ancestors and rejects escape or excessive-depth deep links', async () => {
  const { explorerAncestors } = await import('../src/workspace/explorer')
  expect(explorerAncestors('src/components/View.tsx')).toEqual(['', 'src', 'src/components'])
  expect(explorerAncestors('README.md')).toEqual([''])
  for (const path of [
    '',
    '/etc/passwd',
    'C:/file',
    '../file',
    'a/../file',
    'a//file',
    'a\\file',
    'a\0file',
    `${'a/'.repeat(81)}file`,
  ])
    expect(explorerAncestors(path)).toEqual([])
})

it('searches paths case-insensitively, keeps same-named files in different repositories and bounds results', () => {
  const files = [
    { repoId: 'a', path: 'src/Index.ts' },
    { repoId: 'b', path: 'src/index.ts' },
    { repoId: 'a', path: 'README.md' },
  ]
  expect(searchExplorerFiles(files, ' INDEX ')).toEqual([files[0], files[1]])
  expect(searchExplorerFiles(files, '   ')).toEqual([])
  expect(searchExplorerFiles(files, 'missing')).toEqual([])
  expect(searchExplorerFiles(files, 'src', 1)).toEqual([files[0]])
})
