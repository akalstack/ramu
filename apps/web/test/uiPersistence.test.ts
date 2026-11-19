import { expect, it, vi } from 'vitest'
import { createUiPersistence } from '../src/workspace/uiPersistence'
import type { RamuBridge } from '@ramu/shared/api'

it('never lets a sidebar-only store overwrite saved selection, and flushes the departing active host', () => {
  const invoke = vi.fn(async () => undefined)
  let tick: (() => void) | null = null
  const persistence = createUiPersistence(invoke as unknown as RamuBridge['invoke'], {
    schedule: (run) => {
      tick = run
      return () => {
        tick = null
      }
    },
  })
  const state = { ui: { openTaskIds: ['same'], activeTaskId: 'same', sidebar: 'projects' as const }, taskUi: {} }
  persistence.update(state, true)
  persistence.setLoaded(true)
  expect(tick).toBeNull()
  expect(invoke).not.toHaveBeenCalled()
  persistence.setActive(true)
  expect(tick).not.toBeNull()
  persistence.setActive(false)
  expect(invoke).toHaveBeenCalledWith('ui.setWorkspace', state.ui)
  expect(tick).toBeNull()
  invoke.mockClear()
  persistence.update({ ...state, ui: { ...state.ui, activeTaskId: null } }, true)
  expect(invoke).not.toHaveBeenCalled()
  expect(tick).toBeNull()
})
