import { expect, it } from 'vitest'
import { keepReading, lastReading } from '../src/lib/lastReading'

it('gives a thread back its last reading, apart from other threads and other kinds', () => {
  keepReading('browser', 'host:a', ['tab'])
  keepReading('terminals', 'host:a', ['shell'])
  expect(lastReading('browser', 'host:a')).toEqual(['tab'])
  expect(lastReading('terminals', 'host:a')).toEqual(['shell'])
  expect(lastReading('browser', 'host:b')).toBeUndefined()
})

it('drops the reading used longest ago once it holds too many', () => {
  keepReading('context', 'first', 1)
  keepReading('context', 'second', 2)
  for (let index = 0; index < 400; index++) {
    keepReading('context', `thread-${index}`, index)
    keepReading('context', 'second', 2)
  }
  expect(lastReading('context', 'first')).toBeUndefined()
  expect(lastReading('context', 'second')).toBe(2)
})
