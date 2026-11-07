import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

const workspace = {
  task: (id: string) => ({ t1: { projectId: 'p1' }, t2: { projectId: 'no-project' }, t3: { projectId: 'p2' } })[id],
  projects: [
    { id: 'p1', name: 'Shop' },
    { id: 'p2', name: 'Notes' },
  ],
  repos: { p1: [{ id: 'r1', name: 'shop' }], p2: [] },
}
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/workspace/workspace', () => ({ useWorkspace: () => workspace }))
vi.mock('../src/sidebar/projects/DeployDialog', () => ({ DeployDialog: () => null }))
vi.mock('@/components/desktop-button', () => ({
  Button: ({ children }: { children: unknown }) => createElement('button', {}, children as never),
}))

it('offers Deploy after a met goal only in a project that has a repository', async () => {
  const { GoalDeploy } = await import('../src/chat/GoalDeploy')
  const html = (taskId: string | undefined) => renderToStaticMarkup(createElement(GoalDeploy, { taskId }))
  expect(html('t1')).toContain('Deploy…')
  expect(html('t2')).toBe('')
  expect(html('t3')).toBe('')
  expect(html(undefined)).toBe('')
})
