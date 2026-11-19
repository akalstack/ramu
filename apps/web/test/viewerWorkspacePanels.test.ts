import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ viewer: false, confirm: () => {}, inputs: [] as Record<string, any>[] }))
vi.mock('../src/composer/useViewOnly', () => ({ useViewOnly: () => state.viewer }))
vi.mock('../src/composer/useHostWriteAccess', () => {
  const canWrite = () => !state.viewer
  return { useHostWriteAccess: () => ({ viewOnly: state.viewer, canWrite }) }
})
vi.mock('../src/i18n', () => ({ t: (text: string) => text, useLanguage() {} }))
vi.mock('../src/Menu', () => ({
  Dialog: ({
    children,
    onConfirm,
    confirmDisabled,
  }: {
    children: ReactNode
    onConfirm(): void
    confirmDisabled: boolean
  }) => {
    state.confirm = onConfirm
    return createElement('div', { 'data-confirm-disabled': confirmDisabled }, children)
  },
}))
vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, any>) => {
    state.inputs.push(props)
    return createElement('input', props)
  },
}))
import { WorkspaceAccessBoundary } from '../src/components/workspace-access-boundary'
import { ActionDialog } from '../src/sidebar/explorer/ActionDialog'
import { ConfirmationDialog } from '../src/sidebar/scm/ConfirmationDialog'
import { RemoteChoiceDialog } from '../src/sidebar/scm/RemoteChoiceDialog'
beforeEach(() => {
  state.viewer = false
  state.inputs = []
})
it('keeps draft content mounted but hidden and inert when workspace access becomes view-only', () => {
  state.viewer = true
  const html = renderToStaticMarkup(
    createElement(WorkspaceAccessBoundary, {
      children: createElement('textarea', { defaultValue: 'Kept commit draft' }),
    }),
  )
  expect(html).toContain('cannot access files or Git')
  expect(html).toContain('Kept commit draft')
  expect(html).toContain('hidden=""')
  expect(html).toContain('inert=""')
  expect(html).toContain('display:none')
})
it('keeps a rename draft read-only and refuses an already-open file confirmation', () => {
  const confirm = vi.fn()
  const props = {
    action: { type: 'create', kind: 'file', parent: '' } as const,
    repoName: 'Repo',
    name: 'kept-name.txt',
    setName: vi.fn(),
    nameInput: { current: null },
    busy: false,
    error: null,
    onCancel: vi.fn(),
    onConfirm: confirm,
  }
  renderToStaticMarkup(createElement(ActionDialog, props))
  const retained = state.confirm
  state.viewer = true
  const html = renderToStaticMarkup(createElement(ActionDialog, props))
  expect(html).toContain('kept-name.txt')
  expect(html).toMatch(/readonly=""/i)
  expect(html).toContain('data-confirm-disabled="true"')
  retained()
  state.inputs.at(-1)!.onKeyDown({ key: 'Enter' })
  expect(confirm).not.toHaveBeenCalled()
})
it('refuses retained Git branch and remote-choice confirmations after viewer access', () => {
  const confirm = vi.fn(),
    choose = vi.fn()
  const branch = {
    confirmation: { kind: 'branch' } as const,
    busy: false,
    operationName: 'kept-branch',
    onOperationName: vi.fn(),
    onCancel: vi.fn(),
    onConfirm: confirm,
  }
  renderToStaticMarkup(createElement(ConfirmationDialog, branch))
  const retainedBranch = state.confirm
  const remote = { branch: 'branch', remotes: ['origin'], onCancel: vi.fn(), onChoose: choose }
  renderToStaticMarkup(createElement(RemoteChoiceDialog, remote))
  const retainedRemote = state.confirm
  state.viewer = true
  expect(renderToStaticMarkup(createElement(ConfirmationDialog, branch))).toMatch(/readonly=""/i)
  expect(renderToStaticMarkup(createElement(RemoteChoiceDialog, remote))).toContain('<fieldset disabled=""')
  retainedBranch()
  retainedRemote()
  expect(confirm).not.toHaveBeenCalled()
  expect(choose).not.toHaveBeenCalled()
})
