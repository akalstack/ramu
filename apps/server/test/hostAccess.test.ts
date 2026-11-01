import { expect, it } from 'vitest'
import { deviceMayInvoke, HOST_METHODS } from '../src/remote/access'

const host = { kind: 'host', role: 'owner' } as never
const phone = { role: 'owner' } as never

it('lets a paired host start, check and message its threads and list projects, and nothing else', () => {
  for (const method of HOST_METHODS) expect(deviceMayInvoke(host, method)).toBe(true)
  for (const method of [
    'files.read',
    'git.status',
    'term.create',
    'settings.app.set',
    'agent.events',
    'agent.start',
    'tasks.list',
    'threads.startGroup',
    'browser.activity',
    'network.status',
  ])
    expect(deviceMayInvoke(host, method)).toBe(false)
})

it('keeps the host-only calls away from phones and desktops', () => {
  expect(deviceMayInvoke(phone, 'hostThreads.start')).toBe(false)
  expect(deviceMayInvoke(undefined, 'hostThreads.status')).toBe(false)
  expect(deviceMayInvoke(phone, 'projects.list')).toBe(true)
})
