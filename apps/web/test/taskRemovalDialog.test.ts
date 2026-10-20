import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import type { BackgroundTerminalInfo } from '@ramu/shared/api'
import type { Task } from '@ramu/shared/types'
import { DeleteThreadDialog } from '../src/chat/DeleteThreadDialog'
interface EffectSlot {
  deps: unknown[]
  cleanup?: () => void
}
interface TestNode {
  type?: unknown
  props?: { children?: unknown; checked?: boolean; disabled?: boolean }
}
interface DialogProps {
  confirmDisabled: boolean
  confirmLabel: string
  busy: boolean
  children: unknown
  onConfirm: () => Promise<void>
}
const state = vi.hoisted(() => ({
  slots: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  host: { id: 'a', status: 'connected', invoke: vi.fn() },
  deleted: vi.fn(async () => {}),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useRef: (value: unknown) => {
    const i = state.cursor++
    return (state.slots[i] ??= { current: value })
  },
  useState: (initial: unknown) => {
    const i = state.cursor++
    if (!(i in state.slots)) state.slots[i] = initial
    return [
      state.slots[i],
      (value: unknown) => {
        state.slots[i] = typeof value === 'function' ? value(state.slots[i]) : value
      },
    ]
  },
  useEffect: (effect: () => unknown, deps: unknown[]) => {
    const i = state.cursor++
    const old = state.slots[i] as EffectSlot | undefined
    if (!old || deps.some((value, index) => value !== old.deps[index]))
      state.effects.push(() => {
        old?.cleanup?.()
        const cleanup = effect()
        state.slots[i] = { deps, cleanup: typeof cleanup === 'function' ? (cleanup as () => void) : undefined }
      })
  },
}))
vi.mock('../src/Menu', () => ({ Dialog: 'dialog' }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => state.host }))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('@/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('@/components/ui/checkbox', () => ({ Checkbox: 'checkbox' }))
const task = { id: 'task', title: 'Keep files', mode: 'worktree' } as Task
const row = (id: string, status: BackgroundTerminalInfo['state'] = 'running') =>
  ({ id, taskId: 'task', command: `command-${id}`, state: status }) as BackgroundTerminalInfo
function render() {
  state.cursor = 0
  return DeleteThreadDialog({
    task,
    sharedWorktree: false,
    onDeleted: state.deleted,
    onCancel() {},
  }) as ReactElement<DialogProps>
}
async function flush() {
  for (const effect of state.effects.splice(0)) effect()
  await new Promise((resolve) => setTimeout(resolve, 0))
}
function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(text).join(' ')
  const element = node as TestNode | null
  return element?.props ? text(element.props.children) : ''
}
function find(node: unknown, type: string): TestNode | undefined {
  if (!node || typeof node !== 'object') return undefined
  const element = node as TestNode
  if (element.type === type) return element
  for (const child of [element.props?.children].flat(Infinity)) {
    const result = find(child, type)
    if (result) return result
  }
}
beforeEach(() => {
  state.slots = []
  state.effects = []
  state.host = { id: 'a', status: 'connected', invoke: vi.fn() }
  state.deleted.mockClear()
})
afterEach(() => {
  for (const slot of state.slots) (slot as EffectSlot | undefined)?.cleanup?.()
})

it('shows unknown ownership and keeps the worktree while submitting only the reviewed command IDs', async () => {
  state.host.invoke.mockImplementation(async (method: string) =>
    method === 'term.background.list' ? [row('unknown', 'unknown')] : undefined,
  )
  expect(render().props.confirmDisabled).toBe(true)
  await flush()
  const dialog = render()
  expect(dialog.props.confirmLabel).toBe('Delete thread and forget records')
  expect(text(dialog)).toContain('Unknown commands cannot be stopped')
  expect(find(dialog, 'checkbox')?.props).toMatchObject({ checked: false, disabled: true })
  await dialog.props.onConfirm()
  expect(state.host.invoke).toHaveBeenLastCalledWith('tasks.delete', 'task', false, {
    backgroundIds: ['unknown'],
    forgetUnknown: true,
  })
  expect(state.deleted).toHaveBeenCalledOnce()
})

it('refreshes new commands after refusal and requires another click rather than retrying deletion', async () => {
  let reads = 0,
    deletes = 0
  state.host.invoke.mockImplementation(async (method: string) => {
    if (method === 'term.background.list') return ++reads === 1 ? [row('first')] : [row('first'), row('later')]
    if (++deletes === 1) throw new Error('Background commands changed or need review')
  })
  render()
  await flush()
  await render().props.onConfirm()
  render()
  await flush()
  const refreshed = render()
  expect(text(refreshed)).toContain('command-later')
  expect(deletes).toBe(1)
  expect(state.deleted).not.toHaveBeenCalled()
  await refreshed.props.onConfirm()
  expect(deletes).toBe(2)
  expect(state.host.invoke).toHaveBeenLastCalledWith('tasks.delete', 'task', true, {
    backgroundIds: ['first', 'later'],
    forgetUnknown: false,
  })
})

it('ignores a late deletion response after switching hosts and makes the new dialog independently usable', async () => {
  let release!: () => void
  state.host.invoke.mockImplementation(async (method: string) =>
    method === 'term.background.list'
      ? [row('a-command')]
      : new Promise<void>((resolve) => {
          release = resolve
        }),
  )
  render()
  await flush()
  const pending = render().props.onConfirm()
  const other = vi.fn(async () => [row('b-command')])
  state.host = { id: 'b', status: 'connected', invoke: other }
  render()
  await flush()
  const current = render()
  expect(current.props.busy).toBe(false)
  expect(text(current)).toContain('command-b-command')
  release()
  await pending
  expect(state.deleted).not.toHaveBeenCalled()
  expect(other).toHaveBeenCalledExactlyOnceWith('term.background.list', 'task')
})
