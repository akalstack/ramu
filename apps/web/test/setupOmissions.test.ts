import { expect, it } from 'vitest'
import { canReviewAccess, omissionsLine } from '../src/views/agent/setupOmissions'

it('names what a switch left behind and offers access review only for shared connections', () => {
  expect(omissionsLine(undefined)).toBeNull()
  expect(omissionsLine([])).toBeNull()
  const line = omissionsLine([{ kind: 'shared-mcp', name: 'Atlassian', status: 'approval-needed' }])
  expect(line).toContain('Atlassian')
  expect(canReviewAccess([{ kind: 'shared-mcp', name: 'Atlassian', status: 'approval-needed' }])).toBe(true)
  expect(canReviewAccess([{ kind: 'rule', name: 'Rules', status: 'too-large' }])).toBe(false)
})
