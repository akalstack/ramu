import { expect, it } from 'vitest'
import { listedToasts } from '../src/components/app-toaster'

it('closes the toasts an open panel already lists, keeping progress and the rest', () => {
  const toasts = [
    { id: 'provider-updates', type: 'info' },
    { id: 'agent:s1', type: 'success' },
    { id: 'undo-archive' },
    { id: 'installing', type: 'loading' },
    { id: 'agent:s2', type: 'info', transitionStatus: 'ending' as const },
  ]
  const listed = new Set(['provider-updates', 'agent:s1', 'installing', 'agent:s2'])
  expect(listedToasts(toasts, listed)).toEqual(['provider-updates', 'agent:s1'])
  expect(listedToasts(toasts, new Set())).toEqual([])
})
