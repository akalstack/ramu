import { describe, expect, it } from 'vitest'
import { changeTree } from '../src/shared/changeTree'

const entries = (...paths: string[]) => paths.map((path) => ({ path }))

describe('source control change tree', () => {
  it('groups files by folder and keeps root files at the top level', () => {
    const tree = changeTree(entries('README.md', 'docs/b.md', 'docs/a.md'))
    expect(tree.files.map((file) => file.path)).toEqual(['README.md'])
    expect(tree.folders.map((folder) => folder.name)).toEqual(['docs'])
    expect(tree.folders[0]!.files.map((file) => file.path)).toEqual(['docs/a.md', 'docs/b.md'])
    expect(tree.paths).toHaveLength(3)
  })
  it('compresses chains of single folders into one row', () => {
    const tree = changeTree(entries('src/renderer/src/App.tsx', 'src/renderer/src/views/AgentView.tsx', 'src/main/index.ts'))
    const src = tree.folders[0]!
    expect(src.name).toBe('src')
    expect(src.folders.map((folder) => [folder.name, folder.path])).toEqual([['main', 'src/main'], ['renderer/src', 'src/renderer/src']])
    expect(src.folders[1]!.folders[0]!.path).toBe('src/renderer/src/views')
  })
  it('lists every changed path under a folder for folder actions', () => {
    const tree = changeTree(entries('a/one.ts', 'a/b/two.ts', 'c.ts'))
    expect(tree.folders[0]!.paths.sort()).toEqual(['a/b/two.ts', 'a/one.ts'])
  })
  it('compresses a top-level chain', () => {
    expect(changeTree(entries('x/y/z/file.ts')).folders.map((folder) => folder.name)).toEqual(['x/y/z'])
  })
})
