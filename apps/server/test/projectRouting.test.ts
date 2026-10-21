import { expect, it } from 'vitest'
import { openDb } from '../src/db'
import { Workspace } from '../src/workspace/workspace'

it('stores bounded, de-duplicated aliases and a description, and leaves them off a plain project', () => {
  const workspace = new Workspace(openDb(':memory:'), '/tmp/ramu-routing-worktrees')
  const project = workspace.createProject('Storefront')
  expect(project.aliases).toBeUndefined()
  expect(project.description).toBeUndefined()
  const updated = workspace.setProjectRouting(
    project.id,
    ['  shop ', 'Shop', '', ...Array.from({ length: 20 }, (_, i) => `alias ${i}`)],
    `  ${'x'.repeat(400)}  `,
  )
  expect(updated.aliases).toHaveLength(8)
  expect(updated.aliases![0]).toBe('shop')
  expect(updated.description).toHaveLength(280)
  expect(workspace.listProjects()[0]).toMatchObject({ id: project.id, aliases: updated.aliases })
  expect(workspace.setProjectRouting(project.id, [], '').aliases).toBeUndefined()
})

it('rejects routing hints for a project that does not exist', () => {
  const workspace = new Workspace(openDb(':memory:'), '/tmp/ramu-routing-worktrees')
  expect(() => workspace.setProjectRouting('missing', ['a'], 'b')).toThrow('Unknown project')
})
