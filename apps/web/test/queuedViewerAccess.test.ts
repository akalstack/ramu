import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  menus: [] as { items: { disabled?: boolean }[] }[],
  reorder: (_event: unknown) => {},
  invoke: vi.fn(),
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'a', invoke: state.invoke }) }))
vi.mock('../src/composer/outbox', () => ({ outbox: () => ({ remove: vi.fn(), retry: vi.fn() }) }))
vi.mock('../src/composer/Attachments', () => ({ Attachments: () => null }))
vi.mock('../src/Menu', () => ({
  Menu: (props: { items: { disabled?: boolean }[] }) => {
    state.menus.push(props)
    return null
  },
}))
vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children, onDragEnd }: { children: ReactNode; onDragEnd: (event: unknown) => void }) => {
    state.reorder = onDragEnd
    return createElement('div', null, children)
  },
  useSensors: () => [],
  useSensor: () => null,
  PointerSensor: {},
  KeyboardSensor: {},
  closestCenter: () => {},
}))
vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: ReactNode }) => children,
  useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef() {}, setActivatorNodeRef() {}, transform: null }),
  verticalListSortingStrategy: {},
  sortableKeyboardCoordinates: {},
  arrayMove: () => ['b', 'a'],
}))
const { QueuedMessages } = await import('../src/views/agent/components/QueuedMessages')
const render = (readOnly: boolean, editingId: string | null = null) =>
  renderToStaticMarkup(
    createElement(QueuedMessages, {
      sessionId: 's',
      queued: [
        { id: 'a', text: 'First message', mode: 'queue' },
        { id: 'b', text: 'Second message', mode: 'queue' },
      ],
      pending: [],
      paused: true,
      hostName: 'Host',
      hostOffline: false,
      busyAgent: false,
      supportsSteering: true,
      configuring: false,
      readOnly,
      act: async (work) => {
        await work()
      },
      onRecall: vi.fn(),
      editingId,
      onEdit: vi.fn(),
    }),
  )
beforeEach(() => {
  state.menus = []
  state.invoke.mockClear()
})

it('preserves the host queue while disabling send, edit, remove, resume and drag for a viewer', () => {
  const html = render(true)
  expect(html).toContain('First message')
  expect(html).toContain('Second message')
  for (const label of ['Send now', 'Remove queued message']) {
    const buttons = [...html.matchAll(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`, 'g'))]
    expect(buttons).toHaveLength(2)
    expect(buttons.every(([button]) => button.includes('disabled=""'))).toBe(true)
  }
  expect(html).not.toContain('aria-label="Drag to reorder"')
  expect(state.menus.every((menu) => menu.items[0]?.disabled)).toBe(true)
  state.reorder({ active: { id: 'a' }, over: { id: 'b' } })
  expect(state.invoke).not.toHaveBeenCalled()
})

it('restores the host queue controls for an owner', () => {
  const html = render(false)
  expect(html).toContain('aria-label="Drag to reorder"')
  expect(state.menus.every((menu) => menu.items[0]?.disabled === false)).toBe(true)
  state.reorder({ active: { id: 'a' }, over: { id: 'b' } })
  expect(state.invoke).toHaveBeenCalledWith('agent.reorderQueued', 's', ['b', 'a'])
})

it('marks the message open in the message box and keeps it from being sent or edited twice', () => {
  const html = render(false, 'a')
  expect(html.match(/Editing in the message box/g)).toHaveLength(1)
  const send = [...html.matchAll(/<button[^>]*aria-label="Send now"[^>]*>/g)].map(([button]) => button)
  expect(send.map((button) => button.includes('disabled=""'))).toEqual([true, false])
  expect(state.menus.map((menu) => !!menu.items[0]?.disabled)).toEqual([true, false])
})
