import { expect, it } from 'vitest'
import { pushMessage } from '../src/pushChannels'

it('passes a push event whose channel is known and whose payload has the shape that channel carries', () => {
  const event = { sessionId: 's', event: { kind: 'text', text: 'hi' }, seq: 3 }
  expect(pushMessage('agent:event', event)).toEqual({ channel: 'agent:event', payload: event })
  expect(pushMessage('usage:changed', [])).toEqual({ channel: 'usage:changed', payload: [] })
  expect(pushMessage('workspace:changed', {})).toEqual({ channel: 'workspace:changed', payload: {} })
})

it('drops an unknown channel, a wrong outer shape, or a busy channel missing what clients read at once', () => {
  expect(pushMessage('made:up', {})).toBeNull()
  expect(pushMessage(7, {})).toBeNull()
  expect(pushMessage('usage:changed', {})).toBeNull()
  expect(pushMessage('workspace:changed', null)).toBeNull()
  expect(pushMessage('workspace:changed', [])).toBeNull()
  expect(pushMessage('agent:event', { sessionId: 's', event: {} })).toBeNull()
  expect(pushMessage('agent:event', { event: { kind: 'text' } })).toBeNull()
  expect(pushMessage('term:data', { id: 't', data: 5 })).toBeNull()
  expect(pushMessage('background:connection', { connected: 'yes' })).toBeNull()
})
