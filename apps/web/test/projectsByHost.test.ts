import { expect, it, vi } from 'vitest'

vi.mock('../src/deviceStorage', () => ({ deviceStorage: {} }))
import { sharedProjects } from '../src/sidebar/projectsByHost'

const project = (id: string, repository?: string) => ({ id, name: id, root: null, createdAt: 0, repository })

it('shows a repository two hosts have once, and leaves one-host and remote-less projects with their host', () => {
  const shared = sharedProjects([
    { host: 'mini', projects: [project('ramu', 'github.com/a/ramu'), project('notes')] },
    { host: 'mac', projects: [project('ramu-mac', 'github.com/a/ramu'), project('only', 'github.com/a/only')] },
  ])
  expect(shared.map((group) => [group.name, group.members.map((member) => member.host)])).toEqual([
    ['ramu', ['mini', 'mac']],
  ])
})
