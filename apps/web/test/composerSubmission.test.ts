import { isValidElement, type ReactNode, type ComponentProps } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { FileContext } from '@ramu/shared/types'

const state = vi.hoisted(() => ({
  refs: [] as { current: unknown }[],
  values: [] as unknown[],
  refIndex: 0,
  valueIndex: 0,
  effectIndex: 0,
  effects: [] as { deps: readonly unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[],
  host: 'a',
  viewOnly: false,
  scope: 'project:p',
  pinned: [{ repoId: 'repo', path: 'login.ts' }],
  context: [{ repoId: 'repo', path: 'login.ts', source: 'mention' }] as FileContext[],
  cleared: vi.fn(),
  voicePhase: 'idle',
  voiceStop: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useEffect(run: () => void | (() => void), deps: readonly unknown[]) {
    const index = state.effectIndex++,
      previous = state.effects[index]
    if (
      previous &&
      deps.length === previous.deps.length &&
      deps.every((value, index) => Object.is(value, previous.deps[index]))
    )
      return
    state.pending.push(() => {
      previous?.cleanup?.()
      const cleanup = run()
      state.effects[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    })
  },
  useRef(initial: unknown) {
    const index = state.refIndex++
    return (state.refs[index] ??= { current: initial })
  },
  useState(initial: unknown) {
    const index = state.valueIndex++
    if (!(index in state.values)) state.values[index] = initial
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] = next
      },
    ]
  },
}))
vi.mock('../src/voice/useDictation', () => ({
  useVoiceSettings: () => [{}],
  useVoiceCapability: () => undefined,
  useMicControl: () => ({ kind: 'hidden' }),
  useDictation: () => ({ snapshot: { state: { phase: 'idle' } }, session: { interrupt() {} } }),
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (value: string) => value }))
vi.mock('../src/lib/errors', () => ({ errorText: (error: Error) => error.message }))
vi.mock('../src/ipc', () => ({ ramu: {}, invoke() {} }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: state.host, isLocal: false, invoke() {} }) }))
vi.mock('../src/voice/useDictation', () => ({
  useVoiceSettings: () => [{}, () => {}],
  useVoiceCapability: () => undefined,
  useMicControl: () => ({ kind: 'hidden' }),
  useDictation: () => ({
    snapshot: { state: { phase: state.voicePhase }, level: 0 },
    session: { start() {}, stop: state.voiceStop, cancel() {}, insertReview: () => true },
  }),
}))
vi.mock('../src/composer/ComposerInput', () => ({ ComposerInput: 'textarea' }))
vi.mock('../src/composer/Attachments', () => ({ Attachments: () => null }))
vi.mock('../src/components/ui/button', () => ({ Button: 'button' }))
vi.mock('../src/components/ui/spinner', () => ({ Spinner: () => null }))
vi.mock('../src/composer/ComposerSuggestions', () => ({
  ComposerSuggestions: () => null,
  MAX_PINNED_FILES: 20,
  FILE_DRAG_TYPE: 'test-file',
  useComposerSuggestions: () => ({
    pinned: state.pinned,
    scope: state.scope,
    visible: false,
    choices: [],
    hydrate: () => state.context,
    repoName: () => 'Repo',
    clearPinned: state.cleared,
  }),
}))
vi.mock('../src/composer/useViewOnly', () => ({ useViewOnly: () => state.viewOnly }))
import { Composer } from '../src/composer/Composer'

function RenderComposer(
  onSubmit: (context: FileContext[]) => Promise<void>,
  options: Partial<ComponentProps<typeof Composer>> = {},
) {
  state.refIndex = state.valueIndex = state.effectIndex = 0
  const tree = Composer({
    value: 'Please inspect',
    scopeId: state.scope,
    onChange() {},
    onSubmit,
    placeholder: 'Message',
    submitLabel: 'Send',
    onAttachmentsChange() {},
    ...options,
  })
  while (state.pending.length) state.pending.shift()!()
  return tree
}
function find(
  node: ReactNode,
  predicate: (props: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = find(child, predicate)
      if (found) return found
    }
  }
  if (!isValidElement<Record<string, unknown>>(node)) return
  if (predicate(node.props)) return node.props
  return find(node.props.children as ReactNode, predicate)
}
function send(tree: ReactNode) {
  const button = find(tree, (props) => props['aria-label'] === 'Send')
  expect(button).toBeDefined()
  ;(button!.onClick as () => void)()
}

it('keeps the normal composer actions and leaves Save shortcuts to the app', () => {
  const tree = RenderComposer(async () => {})
  expect(find(tree, (props) => props['aria-label'] === 'Attach files')).toBeDefined()
  expect(find(tree, (props) => props['aria-label'] === 'Save draft')).toBeUndefined()
  expect(find(tree, (props) => props['aria-label'] === 'Saved drafts')).toBeUndefined()
  const input = find(tree, (props) => typeof props.onKeyDown === 'function')!
  for (const modifier of ['metaKey', 'ctrlKey']) {
    const preventDefault = vi.fn()
    ;(input.onKeyDown as (event: unknown) => void)({
      key: 's',
      [modifier]: true,
      nativeEvent: { isComposing: false },
      preventDefault,
    })
    expect(preventDefault).not.toHaveBeenCalled()
  }
})
async function settled() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout }))
  state.refs = []
  state.values = []
  state.effects = []
  state.pending = []
  state.host = 'a'
  state.viewOnly = false
  state.voicePhase = 'idle'
  state.voiceStop.mockClear()
  state.scope = 'project:p'
  state.pinned = [{ repoId: 'repo', path: 'login.ts' }]
  state.cleared.mockClear()
})
afterEach(() => {
  for (const effect of state.effects) effect.cleanup?.()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('keeps pinned context after a rejected submission and exposes the error', async () => {
  const submit = vi.fn(async () => {
    throw new Error('Connection lost')
  })
  send(RenderComposer(submit))
  await settled()
  expect(submit).toHaveBeenCalledWith(state.context)
  expect(state.cleared).not.toHaveBeenCalled()
  expect(find(RenderComposer(submit), (props) => props.role === 'alert')?.children).toBe('Connection lost')
  await vi.advanceTimersByTimeAsync(6000)
  expect(find(RenderComposer(submit), (props) => props.role === 'alert')?.children).toBe('Connection lost')
})

it('clears only the acknowledged unchanged context and ignores repeated sends while pending', async () => {
  let complete!: () => void
  const submit = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  const tree = RenderComposer(submit)
  send(tree)
  send(tree)
  expect(submit).toHaveBeenCalledTimes(1)
  complete()
  await settled()
  expect(state.cleared).toHaveBeenCalledTimes(1)
})

it.each(['host', 'scope', 'pinned'])('a late acknowledgement preserves a changed %s', async (changed) => {
  let complete!: () => void
  const submit = () =>
    new Promise<void>((resolve) => {
      complete = resolve
    })
  send(RenderComposer(submit))
  if (changed === 'host') state.host = 'b'
  if (changed === 'scope') state.scope = 'project:q'
  if (changed === 'pinned') state.pinned = [...state.pinned, { repoId: 'repo', path: 'new.ts' }]
  RenderComposer(submit)
  complete()
  await settled()
  expect(state.cleared).not.toHaveBeenCalled()
})

it('does not show an old host’s submission failure in the newly selected composer', async () => {
  let fail!: (error: Error) => void
  const submit = () =>
    new Promise<void>((_resolve, reject) => {
      fail = reject
    })
  send(RenderComposer(submit))
  state.host = 'b'
  RenderComposer(submit)
  fail(new Error('Old host disconnected'))
  await settled()
  expect(find(RenderComposer(submit), (props) => props.role === 'alert')).toBeUndefined()
  expect(state.cleared).not.toHaveBeenCalled()
})

it('clears the visible input before submission completes and restores it on rejection', async () => {
  let reject!: (error: Error) => void
  const submit = () =>
    new Promise<void>((_resolve, fail) => {
      reject = fail
    })
  send(RenderComposer(submit))
  const pending = find(RenderComposer(submit), (props) => typeof props.onKeyDown === 'function')
  expect(pending?.value).toBe('')
  expect(pending?.readOnly).toBe(true)
  reject(new Error('Offline'))
  await settled()
  expect(find(RenderComposer(submit), (props) => typeof props.onKeyDown === 'function')?.value).toBe('Please inspect')
})

it('does not hide the new host draft while the previous host is sending', () => {
  const submit = () => new Promise<void>(() => {})
  send(RenderComposer(submit))
  state.host = 'b'
  expect(find(RenderComposer(submit), (props) => typeof props.onKeyDown === 'function')?.value).toBe('Please inspect')
})

it('disables Stop, Resume and attachment uploads when the host reports viewer access', () => {
  state.viewOnly = true
  state.pinned = []
  const stopped = RenderComposer(async () => {}, { value: '', chat: true, stop: { active: true, onStop: vi.fn() } })
  expect(find(stopped, (props) => props['aria-label'] === 'Stop')?.disabled).toBe(true)
  expect(find(stopped, (props) => props['aria-label'] === 'Attach files')?.disabled).toBe(true)
  const resume = RenderComposer(async () => {}, { value: '', chat: true, resume: { active: true, onResume: vi.fn() } })
  expect(find(resume, (props) => props['aria-label'] === 'Resume')?.disabled).toBe(true)
  state.viewOnly = false
  const owner = RenderComposer(async () => {}, { value: '', chat: true, stop: { active: true, onStop: vi.fn() } })
  expect(find(owner, (props) => props['aria-label'] === 'Stop')?.disabled).toBe(false)
})

it('blocks both submission callbacks for a viewer even if an event reaches a disabled control', async () => {
  state.viewOnly = true
  const submit = vi.fn(),
    alternate = vi.fn()
  const tree = RenderComposer(submit, { onAlternateSubmit: alternate, alternateLabel: 'Steer' })
  send(tree)
  const input = find(tree, (props) => typeof props.onKeyDown === 'function')!
  ;(input.onKeyDown as (event: unknown) => void)({
    key: 'Enter',
    metaKey: true,
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
  })
  await settled()
  expect(submit).not.toHaveBeenCalled()
  expect(alternate).not.toHaveBeenCalled()
  expect(state.cleared).not.toHaveBeenCalled()
})

it.each(['recording', 'limit'])('Enter finishes a %s take instead of sending the draft', async (phase) => {
  state.voicePhase = phase
  const submit = vi.fn()
  const tree = RenderComposer(submit)
  const input = find(tree, (props) => typeof props.onKeyDown === 'function')!
  ;(input.onKeyDown as (event: unknown) => void)({
    key: 'Enter',
    nativeEvent: { isComposing: false },
    preventDefault: vi.fn(),
  })
  await settled()
  expect(state.voiceStop).toHaveBeenCalledOnce()
  expect(submit).not.toHaveBeenCalled()
})

it('invites speech in the empty box only while the microphone is listening', () => {
  const placeholder = (phase: string) => {
    state.voicePhase = phase
    const tree = RenderComposer(async () => {})
    return find(tree, (props) => 'placeholder' in props)?.placeholder
  }
  expect(placeholder('recording')).toBe('Listening…')
  expect(placeholder('limit')).toBe('Message')
  expect(placeholder('transcribing')).toBe('Message')
})
