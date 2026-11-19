import { describe, expect, it } from 'vitest'
import { requestOutcomes } from '../src/chat/questions'
import type { AgentEvent } from '../src/types'

const permission: AgentEvent = {
  kind: 'permission-request',
  requestId: '1',
  toolName: 'Bash',
  title: 'Allow?',
  detail: 'pwd',
}
const resolved: AgentEvent = { kind: 'request-resolved', requestId: '1', outcome: 'allowed-user' }

describe('requestOutcomes', () => {
  it('does not settle a new permission using a previous reply with the same native id', () => {
    expect(requestOutcomes([permission, resolved]).get('1')).toBe('allowed-user')
    expect(requestOutcomes([permission, resolved, permission]).has('1')).toBe(false)
    expect(requestOutcomes([permission, resolved, permission, resolved]).get('1')).toBe('allowed-user')
  })

  it('preserves outcomes for other requests', () => {
    const other: AgentEvent = { kind: 'request-resolved', requestId: '2', outcome: 'answered' }
    expect(requestOutcomes([permission, resolved, other, permission]).get('2')).toBe('answered')
  })
})
