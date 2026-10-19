import { expect, it, vi } from 'vitest'
import { closeSummary, openSummary, useOpenSummary } from '../src/summaries/openSummary'
import type { SummaryCall } from '../src/summaries/openSummary'

vi.mock('../src/ipc', () => ({ invoke: vi.fn() }))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local' }))
vi.mock('react', () => ({ useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read() }))

it('retains the source host and its client when equal summary IDs appear on different hosts', () => {
  const studio = vi.fn() as unknown as SummaryCall
  const laptop = vi.fn() as unknown as SummaryCall
  openSummary('same', studio, 'studio')
  expect(useOpenSummary()).toEqual({ id: 'same', host: 'studio', call: studio })
  openSummary('same', laptop, 'laptop')
  expect(useOpenSummary()).toEqual({ id: 'same', host: 'laptop', call: laptop })
  closeSummary()
  expect(useOpenSummary()).toBeNull()
})
