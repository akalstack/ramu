import { isValidElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const hooks = vi.hoisted(() => ({
  values: [] as unknown[],
  refs: [] as { current: unknown }[],
  effects: [] as (() => void)[],
  stateIndex: 0,
  refIndex: 0,
  effectIndex: 0,
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const index = hooks.stateIndex++
    if (!(index in hooks.values)) hooks.values[index] = initial
    return [
      hooks.values[index],
      (value: unknown) => {
        hooks.values[index] = value
      },
    ]
  },
  useRef(initial: unknown) {
    const index = hooks.refIndex++
    return (hooks.refs[index] ??= { current: initial })
  },
  useEffect(run: () => () => void) {
    const index = hooks.effectIndex++
    if (!(index in hooks.effects)) hooks.effects[index] = run()
  },
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (value: string) => value }))
vi.mock('../src/components/desktop-input', () => ({ Input: 'input' }))
vi.mock('../src/Menu', () => ({ Dialog: 'dialog' }))
import { WorkspaceNameDialog } from '../src/workspace/WorkspaceNameDialog'

function input(tree: ReactNode): {
  value: string
  disabled: boolean
  onChange: (event: { target: { value: string } }) => void
  onKeyDown: (event: { key: string; nativeEvent: { isComposing: boolean }; preventDefault: () => void }) => void
} {
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const result = input(child)
      if (result) return result
    }
  }
  if (!isValidElement<{ children?: ReactNode }>(tree)) return undefined!
  if (tree.type === 'input') return tree.props as unknown as ReturnType<typeof input>
  return input(tree.props.children)
}
function render(props: Parameters<typeof WorkspaceNameDialog>[0]) {
  hooks.stateIndex = hooks.refIndex = hooks.effectIndex = 0
  const tree = WorkspaceNameDialog(props)
  return {
    tree,
    dialog: tree.props as {
      onConfirm: () => void
      onCancel: () => void
      confirmDisabled: boolean
      busy: boolean
      error: string | null
    },
  }
}
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
beforeEach(() => {
  hooks.values = []
  hooks.refs = []
  hooks.effects = []
})
afterEach(() => {
  for (const dispose of hooks.effects) dispose()
})

it('saves once with the original name despite catalog updates and protects a pending confirmation', async () => {
  let complete!: () => void
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  const close = vi.fn()
  const props = { workspace: { id: 'w', name: 'Original' }, online: true, onSave: save, onClose: close }
  input(render(props).tree).onChange({ target: { value: '  Shared login  ' } })
  props.workspace = { id: 'w', name: 'Changed elsewhere' }
  const { dialog } = render(props)
  dialog.onConfirm()
  dialog.onConfirm()
  dialog.onCancel()
  expect(save).toHaveBeenCalledExactlyOnceWith('Shared login', 'Original')
  expect(close).not.toHaveBeenCalled()
  complete()
  await settle()
  expect(close).toHaveBeenCalledOnce()
})

it('keeps the typed name on old-host and conflict failures and never saves while offline', async () => {
  const save = vi.fn(async () => {
    throw new Error('Unknown method workspaces.rename')
  })
  const props = { workspace: { id: 'w', name: 'Original' }, online: false, onSave: save, onClose: vi.fn() }
  let result = render(props)
  expect(result.dialog.confirmDisabled).toBe(true)
  result.dialog.onConfirm()
  expect(save).not.toHaveBeenCalled()
  props.online = true
  input(render(props).tree).onChange({ target: { value: 'My draft name' } })
  render(props).dialog.onConfirm()
  await settle()
  result = render(props)
  expect(result.dialog.error).toBe('Update this host to rename workspace labels.')
  expect(input(result.tree).value).toBe('My draft name')
  save.mockRejectedValueOnce(new Error('Workspace name changed elsewhere. Reopen the name editor to review it.'))
  result.dialog.onConfirm()
  await settle()
  expect(render(props).dialog.error).toContain('changed elsewhere')
  expect(props.onClose).not.toHaveBeenCalled()
})

it('does not commit an IME composition or close a different editor after disposal', async () => {
  let complete!: () => void
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve
      }),
  )
  const props = { workspace: { id: 'w', name: 'Original' }, online: true, onSave: save, onClose: vi.fn() }
  input(render(props).tree).onChange({ target: { value: 'New name' } })
  const field = input(render(props).tree)
  field.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: true }, preventDefault() {} })
  expect(save).not.toHaveBeenCalled()
  field.onKeyDown({ key: 'Enter', nativeEvent: { isComposing: false }, preventDefault() {} })
  for (const dispose of hooks.effects) dispose()
  complete()
  await settle()
  expect(props.onClose).not.toHaveBeenCalled()
})
