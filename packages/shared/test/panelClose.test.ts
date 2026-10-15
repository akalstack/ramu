import { expect, it } from 'vitest'
import { closingPanel } from '../src/workspace/panelClose'
import type { TaskUiState, ViewDescriptor } from '../src/types'

const file = (id: string): ViewDescriptor => ({ id, kind: 'file', repoId: 'repo', path: id })
const terminal = (id: string): ViewDescriptor => ({ id, kind: 'terminal' })
const state = (views: ViewDescriptor[], activeViewId = views[0]?.id ?? null): TaskUiState => ({ views, activeViewId })

it('keeps closing active or inactive editor tabs instant while another editor remains', () => {
  const tabs = state([file('a'), file('b')])
  expect(closingPanel(tabs, ['a'])).toBeNull()
  expect(closingPanel(tabs, ['b'])).toBeNull()
  expect(closingPanel(tabs, ['missing'])).toBeNull()
  expect(closingPanel(tabs, ['a', 'b'])).toBe('editor')
})

it('animates only the last visible editor or terminal panel', () => {
  const tabs = state([file('a'), terminal('t1'), terminal('t2')])
  expect(closingPanel(tabs, ['a'])).toBe('editor')
  expect(closingPanel(tabs, ['t1'])).toBeNull()
  expect(closingPanel(tabs, ['t1', 't2'])).toBe('terminal')
  expect(closingPanel(tabs, ['a', 't1', 't2'])).toBe('workspace')
  expect(closingPanel({ ...tabs, activeViewId: null }, ['a'])).toBeNull()
  expect(closingPanel({ ...tabs, terminalOpen: false }, ['t1', 't2'])).toBeNull()
})
