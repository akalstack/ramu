import { isValidElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AgentTask, Aside } from '@ramu/shared/types'

const state = vi.hoisted(() => ({
  index: 0,
  values: [] as unknown[],
  invoke: vi.fn(),
  runEffects: false,
  effects: [] as (() => unknown)[],
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect(run: () => unknown) {
    if (state.runEffects) state.effects.push(run)
  },
  useMemo: (compute: () => unknown) => compute(),
  useRef: () => ({ current: null }),
  useState: (initial: unknown) => {
    const index = state.index++
    if (!(index in state.values)) state.values[index] = initial
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] = next
      },
    ]
  },
}))
vi.mock('../src/i18n', () => ({
  useLanguage() {},
  t: (text: string, args: Record<string, unknown> = {}) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(args[key] ?? '')),
}))
vi.mock('../src/workspace/HostProvider', () => ({
  useHost: () => ({ invoke: state.invoke }),
  useHostConnection: () => ({ offline: false }),
}))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: (error: Error) => error.message }))
vi.mock('../src/workspace/workspace', () => ({ useWorkspace: () => ({ dirty: {} }) }))
vi.mock('../src/views/agent/hooks/useElapsed', () => ({ useElapsed: () => null }))
vi.mock('../src/views/agent/components/ThinkingRow', () => ({ ThinkingRow: () => null }))
vi.mock('../src/views/agent/components/CopyButton', () => ({ CopyButton: () => null }))
vi.mock('../src/views/agent/components/AssistantText', () => ({ AssistantText: () => null }))
vi.mock('../src/views/agent/components/UserMessage', () => ({ UserBubble: () => null }))
vi.mock('../src/views/agent/components/ToolGroup', () => ({ ToolGroup: () => null }))
vi.mock('../src/views/agent/components/TurnDiff', () => ({ TurnDiff: () => null }))
vi.mock('../src/chat/AgentContentView', () => ({ AgentContentView: () => null }))
vi.mock('../src/chat/MarkdownText', () => ({ MarkdownText: () => null }))
vi.mock('../src/models/ModelSets', () => ({
  modelDisplayName: (name: string) => name,
  useModelSets: () => ({ catalogs: [] }),
}))
vi.mock('../src/composer/Composer', () => ({ Composer: () => null }))
vi.mock('../src/composer/ComposerInput', () => ({ focusComposer() {} }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { asideModel: null } }) }))
vi.mock('../src/chat/AgentControls', () => ({ providerName: (name: string) => name }))
vi.mock('../src/components/app-toaster', () => ({ notify: { add: vi.fn() } }))
const { AgentTaskPanel } = await import('../src/views/agent/components/AgentTaskPanel')
const { AsidePanel } = await import('../src/views/agent/components/AsidePanel')
const { EditFromHereDialog } = await import('../src/views/agent/components/EditFromHereDialog')
function nodes(tree: ReactNode): Record<string, unknown>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  if (!isValidElement<{ children?: ReactNode }>(tree)) return []
  return [tree.props as Record<string, unknown>, ...nodes(tree.props.children)]
}
const find = (tree: ReactNode, label: string) => nodes(tree).find((props) => props['aria-label'] === label)!
/** The panel's message box, by its label: a shared composer whose `onChange` takes the text. */
const box = (tree: ReactNode, label: string) => nodes(tree).find((props) => props.label === label)!
/** The aside's message box: the thread's composer, which sends through `onSubmit`. */
const asideBox = (tree: ReactNode) => nodes(tree).find((props) => props.submitLabel === 'Ask aside')!
beforeEach(() => {
  state.index = 0
  state.values = []
  state.runEffects = false
  state.effects = []
  state.invoke.mockReset()
  state.invoke.mockResolvedValue({})
})

it('retains a helper draft across role changes and blocks form and keyboard submission for viewers', async () => {
  const task: AgentTask = { agentId: 'a', name: 'Helper', status: 'running', canStop: true, canMessage: true }
  const onMessage = vi.fn()
  const RenderPanel = (readOnly: boolean) => {
    state.index = 0
    return AgentTaskPanel({
      tasks: [task],
      openId: 'a',
      events: [],
      results: new Map(),
      cwd: '',
      live: true,
      onSelect: vi.fn(),
      onClose: vi.fn(),
      onStop: vi.fn(),
      onMessage,
      readOnly,
    })
  }
  ;(box(RenderPanel(false), 'Message Helper').onChange as (value: string) => void)('Keep this draft')
  const viewer = RenderPanel(true)
  expect(box(viewer, 'Message Helper').value).toBe('Keep this draft')
  expect(box(viewer, 'Message Helper').disabled).toBe(true)
  // Sending, by button or Enter, goes through onSend; a viewer's send does nothing.
  ;(box(viewer, 'Message Helper').onSend as () => void)()
  await Promise.resolve()
  expect(onMessage).not.toHaveBeenCalled()
  expect(box(RenderPanel(false), 'Message Helper').value).toBe('Keep this draft')
})

it('keeps aside drafts and existing answers readable without sending or deleting for viewers', async () => {
  const aside = {
    id: 'aside',
    quote: 'Quoted context',
    quoteFrom: 'assistant',
    messages: [{ id: 'm', role: 'assistant', text: 'An existing answer', at: 1 }],
  } as Aside
  const RenderAside = (readOnly: boolean) => {
    state.index = 0
    return AsidePanel({
      sessionId: 's',
      asides: [aside],
      open: { quote: '', from: 'assistant' },
      onClose: vi.fn(),
      onQuote: vi.fn(),
      onPromote: vi.fn(),
      readOnly,
    })
  }
  ;(asideBox(RenderAside(false)).onChange as (value: string) => void)('My follow-up')
  const viewer = RenderAside(true)
  expect(asideBox(viewer).value).toBe('My follow-up')
  expect(
    nodes(viewer).some((props) => (props.event as { text?: string } | undefined)?.text === 'An existing answer'),
  ).toBe(true)
  expect(asideBox(viewer).disabled).toBe(true)
  expect(find(viewer, 'Delete aside').disabled).toBe(true)
  ;(find(viewer, 'Delete aside').onClick as () => void)()
  await (asideBox(viewer).onSubmit as () => Promise<void>)()
  expect(state.invoke).not.toHaveBeenCalled()
  expect(asideBox(RenderAside(false)).value).toBe('My follow-up')
})

it('asks an aside with the model chosen in the thread, so it is answered by that model', async () => {
  const settings = { provider: 'claude-code', model: 'fable' } as never
  const RenderAside = () => {
    state.index = 0
    return AsidePanel({
      sessionId: 's',
      asides: [],
      open: { quote: 'Quoted', from: 'assistant' },
      settings,
      onClose: vi.fn(),
      onQuote: vi.fn(),
      onPromote: vi.fn(),
    })
  }
  ;(asideBox(RenderAside()).onChange as (value: string) => void)('Why this way?')
  await (asideBox(RenderAside()).onSubmit as () => Promise<void>)()
  // The aside's own choices (none here) travel after the thread's model.
  expect(state.invoke).toHaveBeenCalledWith(
    'aside.ask',
    's',
    null,
    'Quoted',
    'assistant',
    'Why this way?',
    settings,
    {},
  )
})

it('does not fetch a revert plan or rewind when a viewer reaches an already-open edit dialog', async () => {
  state.runEffects = true
  const tree = EditFromHereDialog({
    edit: { seq: 1, text: 'Original message', files: [] },
    sessionId: 's',
    live: true,
    offlineHost: undefined,
    onCancel: vi.fn(),
    onRewound: vi.fn(),
    readOnly: true,
  })
  state.effects.splice(0).forEach((effect) => effect())
  const rewind = nodes(tree).find((props) => props.title === 'Files stay as they are')!
  expect(rewind.disabled).toBe(true)
  ;(rewind.onClick as () => void)()
  await Promise.resolve()
  expect(state.invoke).not.toHaveBeenCalled()
})
