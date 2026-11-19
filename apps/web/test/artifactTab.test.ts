import { expect, it } from 'vitest'
import { viewKey } from '../src/workspace/workspaceModel'

it('keeps one tab per artifact beside a thread, whatever its title', () => {
  expect(viewKey({ kind: 'artifact', artifactId: 'a1', title: 'Weekly report' })).toBe('artifact:a1')
  expect(viewKey({ kind: 'artifact', artifactId: 'a1', title: 'Renamed' })).toBe(
    viewKey({ kind: 'artifact', artifactId: 'a1', title: 'Weekly report' }),
  )
})
