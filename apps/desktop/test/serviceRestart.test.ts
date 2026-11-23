import { expect, it } from 'vitest'
import type { PushEvents } from '@ramu/shared/api'
import { ServiceRestart } from '../src/main/serviceRestart'

const make = () => {
  const told: PushEvents['background:connection'][] = []
  return { restart: new ServiceRestart((payload) => told.push(payload)), told }
}

it('passes connection events through when nothing is restarting', () => {
  const { restart, told } = make()
  restart.observe({ connected: false, waiting: 'computer' })
  restart.observe({ connected: true })
  expect(told).toEqual([{ connected: false, waiting: 'computer' }, { connected: true }])
})

it('reads a deliberate restart as restarting, never offline, until the new run answers', () => {
  const { restart, told } = make()
  restart.begin()
  restart.observe({ connected: false, waiting: 'computer' })
  // The old run reconnecting while it drains is still the restart.
  restart.observe({ connected: true })
  restart.observe({ connected: false, waiting: 'computer' })
  expect(told).toEqual([{ connected: false, restarting: true }])
  restart.observe({ connected: true })
  restart.observe({ connected: true, restarted: true })
  expect(told.slice(1)).toEqual([{ connected: true }, { connected: true, restarted: true }])
  // Once back, later events pass through and the end of the restart adds nothing.
  restart.end()
  restart.observe({ connected: false, waiting: 'computer' })
  expect(told.slice(3)).toEqual([{ connected: false, waiting: 'computer' }])
})

it('says offline when a restart ends without the service coming back', () => {
  const { restart, told } = make()
  restart.begin()
  restart.observe({ connected: false, waiting: 'computer' })
  restart.end()
  expect(told).toEqual([
    { connected: false, restarting: true },
    { connected: false, waiting: 'computer' },
  ])
})
