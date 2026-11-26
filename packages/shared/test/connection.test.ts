import { expect, it } from 'vitest'
import { connectionState } from '../src/connection'

it('tells a host still being read again from one that is up to date', () => {
  expect(connectionState('connected', true)).toBe('current')
  expect(connectionState('connected', false)).toBe('synchronizing')
})

it('names a link that is down by why, whatever was read before', () => {
  expect(connectionState('offline', true)).toBe('disconnected')
  expect(connectionState('connecting', false)).toBe('connecting')
  expect(connectionState('rejected', true)).toBe('rejected')
  expect(connectionState('paused', true)).toBe('paused')
})
