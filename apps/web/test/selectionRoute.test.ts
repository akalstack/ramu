import { expect, it, vi } from 'vitest'
import { applyDestination, needsRefresh, routeSelection, type DestinationTarget } from '../src/workspace/selectionRoute'

it('switches connected hosts in the shell and keeps unavailable hosts off screen', () => {
  expect(routeSelection({ host: 'studio', active: 'local', status: null, ready: false })).toBe('pending')
  expect(routeSelection({ host: 'studio', active: 'local', status: 'connected' })).toBe('switch')
  for (const status of ['offline', 'connecting', 'paused', 'rejected', null] as const)
    expect(routeSelection({ host: 'studio', active: 'local', status })).toBe('unavailable')
  expect(routeSelection({ host: 'local', active: 'local', status: null })).toBe('here')
})

it('opens a destination only in the supplied host store, and a host-only selection preserves its tabs', () => {
  const store = {
    tasks: [{ id: 'same' }],
    openTask: vi.fn(),
    openView: vi.fn(),
    setSidebar: vi.fn(),
    openProject: vi.fn(),
    newTask: vi.fn(),
  } as unknown as DestinationTarget
  const openSummary = vi.fn()
  expect(applyDestination(store, { kind: 'task', taskId: 'missing' }, { openSummary })).toBe(false)
  expect(store.openTask).not.toHaveBeenCalled()
  expect(applyDestination(store, { kind: 'task', taskId: 'same', sessionId: 'chat' }, { openSummary })).toBe(true)
  expect(store.openView).toHaveBeenCalledWith('same', { kind: 'agent', sessionId: 'chat' })
  expect(needsRefresh({ kind: 'task', taskId: 'same' }, null)).toBe(true)
  vi.clearAllMocks()
  expect(applyDestination(store, { kind: 'host' }, { openSummary })).toBe(true)
  expect(store.openTask).not.toHaveBeenCalled()
  expect(store.setSidebar).not.toHaveBeenCalled()
})

it('opens a destination the store already holds without waiting, and waits only for one it has not seen', () => {
  const store = { tasks: [{ id: 'held' }], projects: [{ id: 'kept' }] } as never
  expect(needsRefresh({ kind: 'task', taskId: 'held' }, store)).toBe(false)
  expect(needsRefresh({ kind: 'project', projectId: 'kept' }, store)).toBe(false)
  expect(needsRefresh({ kind: 'task', taskId: 'from-phone' }, store)).toBe(true)
  expect(needsRefresh({ kind: 'project', projectId: 'new' }, store)).toBe(true)
  expect(needsRefresh({ kind: 'inbox' }, store)).toBe(false)
})
