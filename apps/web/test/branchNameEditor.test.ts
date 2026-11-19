import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { BranchNameEditor } from '../src/workspace/BranchNameEditor'
interface HookCell {
  value?: unknown
  current?: unknown
  deps?: unknown[]
  cleanup?: () => void
}
interface TestProps {
  children?: ReactNode
  onClick: () => Promise<void>
  onChange: (event: { target: { value: string } }) => void
}
const rig = vi.hoisted(() => ({ cells: [] as HookCell[], cursor: 0, invoke: vi.fn() }))
// Exercise the real handlers with persistent hook cells and effect cleanup at the React boundary.
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useCallback: (callback: unknown) => callback,
  useState: (initial: unknown) => {
    const n = rig.cursor++
    if (!(n in rig.cells)) rig.cells[n] = { value: initial }
    return [
      rig.cells[n]!.value,
      (value: unknown) => {
        rig.cells[n] = { value }
      },
    ]
  },
  useRef: (initial: unknown) => {
    const n = rig.cursor++
    return (rig.cells[n] ??= { current: initial })
  },
  useEffect: (effect: () => void | (() => void), deps: unknown[]) => {
    const n = rig.cursor++
    const previous = rig.cells[n]
    if (!previous || deps.some((value, i) => value !== previous.deps?.[i])) {
      previous?.cleanup?.()
      const cleanup = effect()
      rig.cells[n] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined }
    }
  },
}))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: rig.invoke }) }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('@/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('@/components/desktop-input', () => ({ Input: 'input' }))
function elements(node: unknown): ReactElement<TestProps>[] {
  if (!isValidElement<TestProps>(node)) return []
  return [node, ...[node.props.children].flat(Infinity).flatMap(elements)]
}
const intent = { strategy: 'semantic' as const, instructions: '', prompt: 'Fix login' }
const changed = vi.fn()
function render(prompt = 'Fix login', busy = false, title = prompt) {
  rig.cursor = 0
  return elements(
    BranchNameEditor({ projectId: 'project', title, intent: { ...intent, prompt }, onChange: changed, busy }),
  )
}
beforeEach(() => {
  rig.cells = []
  rig.cursor = 0
  rig.invoke.mockReset()
  changed.mockReset()
})
it('a manual edit wins over a pending generated result', async () => {
  let finish!: (value: unknown) => void
  rig.invoke.mockImplementation((method: string) =>
    method === 'tasks.cancelBranch'
      ? Promise.resolve()
      : new Promise((resolve) => {
          finish = resolve
        }),
  )
  const tree = render()
  const pending = tree.find((n) => n.type === 'button')!.props.onClick()
  tree.find((n) => n.type === 'input')!.props.onChange({ target: { value: 'team/my-name' } })
  finish({ name: 'fix/generated', source: 'generated' })
  await pending
  expect(changed.mock.calls).toEqual([[{ name: 'team/my-name', source: 'manual' }]])
  expect(rig.invoke).toHaveBeenCalledWith('tasks.cancelBranch', rig.invoke.mock.calls[0]![4])
})
it('changed task inputs, sending and unmount discard late results', async () => {
  for (const invalidate of [
    () => render('Different request'),
    () => render('Fix login', false, 'Discuss different attachment'),
    () => render('Fix login', true),
    () => rig.cells.forEach((cell) => cell?.cleanup?.()),
  ]) {
    rig.cells = []
    changed.mockClear()
    let finish!: (value: unknown) => void
    rig.invoke.mockImplementation((method: string) =>
      method === 'tasks.cancelBranch'
        ? Promise.resolve()
        : new Promise((resolve) => {
            finish = resolve
          }),
    )
    const pending = render()
      .find((n) => n.type === 'button')!
      .props.onClick()
    invalidate()
    finish({ name: 'fix/stale', source: 'generated' })
    await pending
    expect(changed).not.toHaveBeenCalled()
  }
})
it('generation uses the selected project and bounded intent without creating a workspace', async () => {
  rig.invoke.mockResolvedValue({ name: 'fix/login', source: 'generated' })
  await render()
    .find((n) => n.type === 'button')!
    .props.onClick()
  expect(rig.invoke).toHaveBeenCalledExactlyOnceWith(
    'tasks.generateBranch',
    'project',
    'Fix login',
    intent,
    expect.any(String),
  )
  expect(changed).toHaveBeenCalledWith({ name: 'fix/login', source: 'generated' })
})
