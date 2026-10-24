import { beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@ramu/shared/types'
const state = vi.hoisted(() => ({
  viewer: false,
  rows: [] as Task[],
  cursor: 0,
  slots: [] as unknown[],
  host: { id: 'a', isLocal: false, status: 'connected', invoke: vi.fn() },
  refresh: vi.fn(),
  forget: vi.fn(),
  clear: vi.fn(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useEffect() {},
  useRef: (value: unknown) => (state.slots[state.cursor++] ??= { current: value }),
  useState: (value: unknown) => {
    const index = state.cursor++
    if (!(index in state.slots)) state.slots[index] = value
    return [
      state.slots[index],
      (next: unknown) => {
        state.slots[index] = next
      },
    ]
  },
}))
vi.mock('../src/composer/useViewOnly', () => ({ useViewOnly: () => state.viewer }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => state.host }))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({ tasks: state.rows, projects: [], refresh: state.refresh, forgetTask: state.forget }),
}))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/sidebar/projects/threadSelection', () => ({
  threadSelection: { clear: state.clear },
  useThreadSelection: () => new Set(),
}))
vi.mock('../src/sidebar/projects/TaskRow', () => ({ TaskRow: () => null }))
vi.mock('@/components/settings-row', () => ({ SettingsGroupTitle: 'h4' }))
vi.mock('../src/Menu', () => ({ Dialog: 'Dialog' }))
vi.mock('../src/chat/DeleteThreadDialog', () => ({ DeleteThreadDialog: () => null }))
vi.mock('../src/workspace/threadListMotion', () => ({ animateThreadListChange: (run: () => unknown) => run() }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
import { useBulkThreadActions } from '../src/sidebar/projects/ThreadSelectionBar'
import { useHostWriteAccess } from '../src/composer/useHostWriteAccess'
const tasks = [
  { id: 'one', status: 'idle', pinnedAt: null },
  { id: 'two', status: 'idle', pinnedAt: null },
] as Task[]
const RenderActions = () => {
  state.cursor = 0
  return useBulkThreadActions()
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
beforeEach(() => {
  vi.clearAllMocks()
  state.rows = []
  state.slots = []
  state.cursor = 0
  state.viewer = false
  state.host = { id: 'a', isLocal: false, status: 'connected', invoke: vi.fn().mockResolvedValue(undefined) }
})
it('retained bulk actions refuse viewer writes and deletion while local selection cleanup stays available', async () => {
  const retained = RenderActions()
  state.viewer = true
  expect(RenderActions().viewOnly).toBe(true)
  retained.pin(tasks)
  retained.done(tasks)
  retained.archive(tasks)
  retained.requestDelete(tasks)
  await settle()
  expect(state.host.invoke).not.toHaveBeenCalled()
  expect(RenderActions().deleting).toEqual([])
  retained.cancelDelete()
})
it.each(['viewer', 'disconnect', 'host switch'])('stops the remainder of a batch after a %s change', async (change) => {
  let finish!: () => void
  const original = state.host.invoke
  original.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve
      }),
  )
  RenderActions().archive(tasks)
  expect(original).toHaveBeenCalledTimes(1)
  if (change === 'viewer') state.viewer = true
  if (change === 'disconnect') state.host = { ...state.host, status: 'disconnected' }
  if (change === 'host switch') state.host = { ...state.host, id: 'b', invoke: vi.fn() }
  RenderActions()
  finish()
  await settle()
  expect(original).toHaveBeenCalledTimes(1)
  if (change === 'host switch') expect(state.host.invoke).not.toHaveBeenCalled()
  expect(state.clear).not.toHaveBeenCalled()
})
it('allows a fresh callback after access recovers but never retargets an old host callback', () => {
  state.cursor = 0
  const first = useHostWriteAccess()
  state.host = { ...state.host, id: 'b' }
  state.cursor = 0
  expect(useHostWriteAccess().canWrite()).toBe(true)
  expect(first.canWrite()).toBe(false)
  state.viewer = true
  state.cursor = 0
  expect(useHostWriteAccess().canWrite()).toBe(false)
  state.viewer = false
  state.cursor = 0
  expect(useHostWriteAccess().canWrite()).toBe(true)
})

it('keeps an inline rename draft when access becomes read-only and still allows cancel', async () => {
  const { InlineEdit } = await import('../src/sidebar/projects/InlineEdit')
  const done = vi.fn()
  const edit = (readOnly: boolean) => {
    state.cursor = 0
    return InlineEdit({ value: 'Original', onDone: done, readOnly })
  }
  edit(false).props.onChange({ target: { value: 'Draft title' } })
  const viewer = edit(true)
  expect(viewer.props.value).toBe('Draft title')
  expect(viewer.props.readOnly).toBe(true)
  viewer.props.onBlur()
  viewer.props.onKeyDown({ key: 'Enter', stopPropagation() {} })
  expect(done).not.toHaveBeenCalled()
  viewer.props.onKeyDown({ key: 'Escape', stopPropagation() {} })
  expect(done).toHaveBeenCalledWith(null)
  const restored = edit(false)
  expect(restored.props.value).toBe('Draft title')
  restored.props.onBlur()
  expect(done).toHaveBeenCalledWith('Draft title')
})

it('keeps a routing draft and blocks an old Save callback when the dialog becomes view-only', async () => {
  const { ProjectRoutingDialog } = await import('../src/sidebar/projects/ProjectRoutingDialog')
  const save = vi.fn().mockResolvedValue(undefined)
  const close = vi.fn()
  const RenderRouting = (readOnly: boolean) => {
    state.cursor = 0
    return ProjectRoutingDialog({ project: { id: 'project', name: 'Project' }, readOnly, onSave: save, onClose: close })
  }
  const before = RenderRouting(false)
  const children = before.props.children as { props?: { 'aria-label'?: string; onChange?: (event: unknown) => void } }[]
  children.find((child) => child?.props?.['aria-label'] === 'Other names, separated by commas')!.props!.onChange!({
    target: { value: 'Draft alias' },
  })
  const retained = RenderRouting(false).props.onConfirm
  const viewer = RenderRouting(true)
  expect(viewer.props.confirmDisabled).toBe(true)
  retained()
  await settle()
  expect(save).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  RenderRouting(false).props.onConfirm()
  await settle()
  expect(save).toHaveBeenCalledWith(['Draft alias'], '')
  expect(close).toHaveBeenCalledOnce()
})

it('blocks an archived-history deletion confirmation retained across a viewer change', async () => {
  const { ArchivedThreads } = await import('../src/settings/ArchivedThreads')
  state.rows = tasks.map((task) => ({ ...task, status: 'archived' }))
  const nodes = (node: any): any[] =>
    !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]
  const RenderHistory = () => {
    state.cursor = 0
    return ArchivedThreads()
  }
  const remove = nodes(RenderHistory()).find((node) => node.props?.children === 'Delete all archived threads')
  remove.props.onClick()
  const confirm = nodes(RenderHistory()).find((node) => node.type === 'Dialog').props.onConfirm
  state.viewer = true
  const viewer = RenderHistory()
  expect(nodes(viewer).find((node) => node.type === 'Dialog').props.confirmDisabled).toBe(true)
  await confirm()
  expect(state.host.invoke).not.toHaveBeenCalled()
  expect(state.forget).not.toHaveBeenCalled()
})
