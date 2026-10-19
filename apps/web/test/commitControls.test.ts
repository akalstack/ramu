import { createElement, isValidElement, type ComponentProps, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Button } from '../src/components/desktop-button'
import { COMMIT_ACTION } from '../src/sidebar/scm/classes'
import { beforeEach, expect, it, vi } from 'vitest'
import { CommitBox } from '../src/sidebar/scm/CommitBox'
import { Menu } from '../src/Menu'
import { SyncButton } from '../src/git/GitControls'
const state = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({ preferences: { defaultCommitAction: 'commit' }, save: state.save }),
}))
vi.mock('../src/i18n', () => ({ t: (text: string) => text }))
vi.mock('../src/chat/AgentControls', () => ({ providerName: String }))
vi.mock('../src/Menu', () => ({ Menu: () => null }))
vi.mock('../src/git/GitControls', () => ({ SyncButton: () => null }))
vi.mock('../src/workspace/TaskPane', () => ({ errorText: String }))
vi.mock('../src/commands', () => ({ formatKeys: String }))
const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...[node.props.children].flat(Infinity).flatMap((child) => elements(child as ReactNode))]
}
const props = (): ComponentProps<typeof CommitBox> => ({
  repoName: 'project',
  canCreatePr: false,
  status: null,
  stagedCount: 1,
  unstagedCount: 0,
  conflictCount: 0,
  loading: false,
  busy: false,
  generating: false,
  message: 'Save changes',
  draft: null,
  onMessage: vi.fn(),
  onDraft: vi.fn(),
  onGenerate: vi.fn(),
  commit: vi.fn().mockResolvedValue(undefined),
  onSync: vi.fn(),
  onPublishRepository: vi.fn(),
  reportError: vi.fn(),
})
beforeEach(() => {
  vi.clearAllMocks()
  state.save.mockResolvedValue(undefined)
})

it('keeps the primary action and options unavailable during conflicts or active work', () => {
  for (const patch of [{ conflictCount: 1 }, { busy: true }, { loading: true }, { generating: true }]) {
    const input = { ...props(), ...patch }
    const tree = elements(CommitBox(input))
    const commit = tree.find((node) => node.props['aria-label'] === 'Commit' && !!node.props.onClick)!
    expect(commit.props.disabled).toBe(true)
    expect(tree.find((node) => node.type === Menu)?.props.disabled).toBe(true)
    ;(commit.props.onClick as () => void)()
    expect(input.commit).not.toHaveBeenCalled()
  }
})

it('runs the selected commit action once from the primary control', () => {
  const input = props()
  const action = elements(CommitBox(input)).find(
    (node) => node.props['aria-label'] === 'Commit' && !!node.props.onClick,
  )!
  ;(action.props.onClick as () => void)()
  expect(input.commit).toHaveBeenCalledExactlyOnceWith('commit')
})

it('keeps a clean tree with outgoing changes on the sync path', () => {
  const input = props()
  input.stagedCount = 0
  input.status = {
    entries: [],
    branch: 'main',
    remote: 'origin',
    upstream: 'origin/main',
    ahead: 1,
    behind: 0,
  } as never
  const tree = elements(CommitBox(input))
  expect(tree.some((node) => node.type === Menu)).toBe(false)
  const sync = tree.find((node) => node.type === SyncButton)!
  ;(sync.props.onSync as () => void)()
  expect(input.onSync).toHaveBeenCalledOnce()
  expect(input.commit).not.toHaveBeenCalled()
})

it('retains the theme’s primary foreground when compact typography is merged', () => {
  const html = renderToStaticMarkup(
    createElement(Button, { variant: 'default', size: 'sm', className: COMMIT_ACTION }, 'Commit'),
  )
  expect(html).toContain(' text-primary-foreground ')
  expect(html).toContain(' disabled:text-muted-foreground ')
})
