import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_THEME } from '@ramu/shared/theme'
const h = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  near: true,
  url: 'ramu-content://preview/document',
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  mounted: vi.fn(),
  post: vi.fn(),
  listeners: new Set<(event: unknown) => void>(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useId: () => 'candidate',
  useCallback: (callback: unknown, deps: unknown[]) => {
    const index = h.cursor++
    const previous = h.slots[index] as { callback: unknown; deps: unknown[] } | undefined
    if (previous && deps.every((dep, i) => dep === previous.deps[i])) return previous.callback
    h.slots[index] = { callback, deps }
    return callback
  },
  useMemo: (compute: () => unknown) => compute(),
  useRef: (initial: unknown) => (h.slots[h.cursor++] ??= { current: initial }),
  useState: (initial: unknown) => {
    const index = h.cursor++
    if (!(index in h.slots)) h.slots[index] = typeof initial === 'function' ? initial() : initial
    return [
      h.slots[index],
      (next: unknown) => {
        h.slots[index] = typeof next === 'function' ? next(h.slots[index]) : next
      },
    ]
  },
  useEffect: (run: () => void | (() => void), deps: unknown[]) => {
    const index = h.cursor++,
      previous = h.effects[index]
    if (previous && deps.every((dep, i) => dep === previous.deps[i])) return
    h.pending.push(() => {
      previous?.cleanup?.()
      h.effects[index] = { deps, cleanup: run() || undefined }
    })
  },
}))
vi.mock('../src/lib/useNearViewport', () => ({ useNearViewport: () => h.near }))
vi.mock('../src/i18n', () => ({ t: (value: string) => value, useLanguage: () => 'en' }))
vi.mock('../src/interactive/useContentDocument', () => ({
  useContentDocument: (...args: unknown[]) => {
    h.mounted(...args)
    return { url: args[2] ? h.url : '', error: '' }
  },
}))
vi.mock('@ramu/shared/interactiveLease', () => ({ claimInteractive: () => () => {} }))
import { InteractiveThemePreview } from '../src/theme/InteractiveThemePreview'
import { EditorThemePreview } from '../src/theme/EditorThemePreview'
const child = { postMessage: h.post }
function RenderPreview(variant = DEFAULT_THEME.dark, appearance: 'dark' | 'light' = 'dark') {
  h.cursor = 0
  const tree = InteractiveThemePreview({ variant, appearance })
  for (const element of [tree.props.children].flat())
    if (element?.props?.ref) element.props.ref.current = { contentWindow: child }
  while (h.pending.length) h.pending.shift()!()
  return tree
}
const send = (data: unknown, source: unknown = child) => {
  for (const listener of h.listeners) listener({ data, source })
}
beforeEach(() => {
  h.slots = []
  h.effects = []
  h.pending = []
  h.near = true
  h.url = 'ramu-content://preview/document'
  h.listeners.clear()
  h.post.mockClear()
  h.mounted.mockClear()
  vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('window', {
    addEventListener: (_event: string, handler: (event: unknown) => void) => h.listeners.add(handler),
    removeEventListener: (_event: string, handler: (event: unknown) => void) => h.listeners.delete(handler),
  })
})
afterEach(() => {
  for (const effect of h.effects) effect?.cleanup?.()
  vi.unstubAllGlobals()
})
it('updates candidate tokens through the production theme bridge without changing the mounted source or declared controls', () => {
  RenderPreview()
  const [source, instance, , state] = h.mounted.mock.calls[0]!
  const scenario = { controls: [{ key: '0:quantity', value: '8', checked: false }], custom: null }
  send({ ramuInteractive: 1, instance, type: 'state', value: scenario }, {})
  expect(state.current).toBeNull()
  send({ ramuInteractive: 1, instance, type: 'state', value: scenario })
  expect(state.current).toEqual(scenario)
  const variant = { ...DEFAULT_THEME.light, colors: { ...DEFAULT_THEME.light.colors, accent: '#123456' } }
  RenderPreview(variant, 'light')
  const latest = h.mounted.mock.calls.at(-1)!
  expect(latest[0]).toBe(source)
  expect(latest[1]).toBe(instance)
  expect(latest[3]).toBe(state)
  expect(latest[3].current).toEqual(scenario)
  const palette = h.post.mock.calls.at(-1)![0]
  expect(palette.type).toBe('theme')
  expect(palette.value['--primary']).toBe('#123456')
  expect(palette.value['--scheme']).toBe('light')
  h.near = false
  RenderPreview(variant, 'light')
  expect(h.mounted.mock.calls.at(-1)![2]).toBe(false)
})

it('registers the ready listener before the asynchronous document URL arrives', () => {
  h.url = ''
  RenderPreview()
  const earlyListener = [...h.listeners][0]!
  h.url = 'ramu-content://ready/document'
  RenderPreview()
  expect([...h.listeners][0]).toBe(earlyListener)
  const instance = h.mounted.mock.calls.at(-1)![1]
  earlyListener({ source: child, data: { ramuInteractive: 1, instance, type: 'ready' } })
  const tree = RenderPreview()
  const frame = [tree.props.children].flat().find((element) => element?.props?.url)
  expect(frame.props.ready).toBe(true)
})

interface PreviewElement {
  type: unknown
  key?: unknown
  props: {
    children?: unknown
    ref?: { current: unknown }
    onLoad?(): void
    onClick?(): void
    style?: { opacity?: number }
    src?: string
  }
}
function elements(tree: unknown): PreviewElement[] {
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return []
  const node = tree as PreviewElement
  return [node, ...[node.props.children].flat(Infinity).flatMap(elements)]
}
function RenderEditor(variant = DEFAULT_THEME.light) {
  h.cursor = 0
  const tree = EditorThemePreview({ variant, appearance: 'light' })
  const frame = elements(tree).find((node) => node.type === 'iframe')
  if (frame) frame.props.ref!.current = { contentWindow: child }
  while (h.pending.length) h.pending.shift()!()
  return tree
}
it('routes only palette/view data to the isolated editor and ignores forged or superseded acknowledgements', () => {
  let tree = RenderEditor()
  let frame = elements(tree).find((node) => node.type === 'iframe')!
  frame.props.onLoad!()
  const update = h.post.mock.calls.at(-1)![0]
  expect(update.view).toBe('code')
  expect(update).not.toHaveProperty('source')
  send({ ...update, type: 'applied' }, {})
  expect(elements(RenderEditor()).find((node) => node.type === 'iframe')!.props.style?.opacity).toBe(0)
  send({ ...update, type: 'applied' })
  tree = RenderEditor()
  frame = elements(tree).find((node) => node.type === 'iframe')!
  expect(frame.props.style?.opacity).toBe(1)
  const originalUrl = frame.props.src
  elements(tree).find((node) => node.props.children === 'Diff')!.props.onClick!()
  tree = RenderEditor()
  expect(h.post.mock.calls.at(-1)![0].view).toBe('diff')
  expect(elements(tree).find((node) => node.type === 'iframe')!.props.src).toBe(originalUrl)
  const count = h.post.mock.calls.length
  const invalid = { ...DEFAULT_THEME.light, colors: { ...DEFAULT_THEME.light.colors, canvas: 'incomplete' } }
  RenderEditor(invalid)
  expect(h.post.mock.calls.length).toBe(count)
  send({ ...update, type: 'applied' })
  tree = RenderEditor(invalid)
  expect(elements(tree).some((node) => node.props.children === 'Complete each color before previewing.')).toBe(true)
  RenderEditor()
  const current = h.post.mock.calls.at(-1)![0]
  send({ ...current, type: 'error' })
  tree = RenderEditor()
  const oldFrame = elements(tree).find((node) => node.type === 'iframe')!
  elements(tree).find((node) => node.props.children === 'Run again')!.props.onClick!()
  tree = RenderEditor()
  const newFrame = elements(tree).find((node) => node.type === 'iframe')!
  expect(newFrame.key).not.toBe(oldFrame.key)
  expect(newFrame.props.src).not.toBe(oldFrame.props.src)
})
