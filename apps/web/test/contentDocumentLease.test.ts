import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { InteractiveState } from '@ramu/shared/interactive'
const harness = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  invoke: vi.fn(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useRef: (initial: unknown) => (harness.slots[harness.cursor++] ??= { current: initial }),
  useState: (initial: unknown) => {
    const index = harness.cursor++
    if (!(index in harness.slots)) harness.slots[index] = initial
    return [
      harness.slots[index],
      (next: unknown) => {
        harness.slots[index] = next
      },
    ]
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = harness.cursor++
    const previous = harness.effects[index]
    if (previous && deps.every((dep, i) => dep === previous.deps[i])) return
    harness.pending.push(() => {
      previous?.cleanup?.()
      harness.effects[index] = { deps, cleanup: run() || undefined }
    })
  },
}))
vi.mock('../src/ipc', () => ({ ramu: { invoke: harness.invoke } }))
import { useContentDocument } from '../src/interactive/useContentDocument'
import { ContentFrame } from '../src/interactive/ContentFrame'
const state = { current: null as InteractiveState | null }
function RenderDocument(html = '<p>sample</p>', active = true, instance = 'one') {
  harness.cursor = 0
  const result = useContentDocument(html, instance, active, state)
  while (harness.pending.length) harness.pending.shift()!()
  return result
}
const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}
beforeEach(() => {
  harness.slots = []
  harness.effects = []
  harness.pending = []
  state.current = null
  harness.invoke.mockReset().mockResolvedValue(undefined)
})
afterEach(() => {
  for (const effect of harness.effects) effect?.cleanup?.()
})
it('releases a mount returned after replacement and never shows its obsolete URL', async () => {
  let finish!: (url: string) => void
  harness.invoke.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  RenderDocument()
  harness.invoke.mockResolvedValueOnce('ramu-content://new/document')
  RenderDocument('<p>new source</p>', true, 'two')
  await flush()
  expect(RenderDocument('<p>new source</p>', true, 'two').url).toBe('ramu-content://new/document')
  finish('ramu-content://old/document')
  await flush()
  expect(harness.invoke).toHaveBeenCalledWith('app.content.release', 'ramu-content://old/document')
  expect(RenderDocument('<p>new source</p>', true, 'two').url).toBe('ramu-content://new/document')
})
it('masks released URLs immediately and rebuilds a resumed document from the latest declared state', async () => {
  harness.invoke.mockResolvedValueOnce('ramu-content://first/document')
  RenderDocument()
  await flush()
  expect(RenderDocument().url).toContain('first')
  expect(RenderDocument(undefined, false).url).toBe('')
  expect(harness.invoke).toHaveBeenCalledWith('app.content.release', 'ramu-content://first/document')
  state.current = { controls: [], custom: { quantity: 9 } }
  harness.invoke.mockResolvedValueOnce('ramu-content://resumed/document')
  expect(RenderDocument().url).toBe('')
  await flush()
  expect(RenderDocument().url).toContain('resumed')
  const source = harness.invoke.mock.calls.filter(([method]) => method === 'app.content.mount').at(-1)?.[1]
  expect(source).toContain('"quantity":9')
})
it('keeps a failed or cancelled preview from altering another mounted document', async () => {
  harness.invoke.mockRejectedValueOnce(new Error('unavailable'))
  RenderDocument()
  await flush()
  expect(RenderDocument().error).toContain('unavailable')
  expect(RenderDocument(undefined, false).error).toBe('')
  harness.invoke.mockResolvedValueOnce('ramu-content://recovered/document')
  expect(RenderDocument().error).toBe('')
  await flush()
  expect(RenderDocument().url).toContain('recovered')
})
it('keeps both transcript and theme document frames sandboxed without a shared origin', () => {
  const html = renderToStaticMarkup(
    createElement(ContentFrame, { url: 'ramu-content://sample/document', title: 'Sample', ready: true, onLoad() {} }),
  )
  expect(html).toContain('sandbox="allow-scripts"')
  expect(html).not.toContain('allow-same-origin')
  expect(html).not.toContain('srcDoc')
})
