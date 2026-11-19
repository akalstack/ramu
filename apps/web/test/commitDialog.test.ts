import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { GitStatus } from '@ramu/shared/types'
import { chooseCommit, CommitDialog } from '../src/git/CommitDialog'

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  cursor: 0,
  effects: [] as (() => void)[],
  support: false,
  invoke: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState(initial: unknown) {
    const index = state.cursor++
    const values = state.values
    if (!(index in values)) values[index] = initial
    return [
      values[index],
      (value: unknown) => {
        values[index] = value
      },
    ]
  },
  useEffect(effect: () => () => void) {
    const index = state.cursor++
    if (!(index in state.values)) {
      state.values[index] = true
      state.effects.push(effect())
    }
  },
  useMemo: (compute: () => unknown) => compute(),
}))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/ipc', () => ({ invoke: vi.fn() }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: state.invoke }) }))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({
    preferences: { defaultCommitAction: 'commit', defaultCommitBranch: 'current' },
    save: vi.fn().mockResolvedValue(undefined),
  }),
}))
vi.mock('../src/git/usePullRequestSupport', () => ({ usePullRequestSupport: () => state.support }))

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...elements(node.props.children as ReactNode)]
}
const status = {
  branch: 'main',
  remote: true,
  entries: [{ path: 'file.ts', staged: 'modified', unstaged: null }],
} as GitStatus

async function open(pullRequest: boolean) {
  state.cursor = 0
  CommitDialog()
  const result = chooseCommit({
    taskId: 'task',
    repoId: 'repo',
    repoName: 'Project',
    status,
    action: 'push',
    message: 'Fix',
    pullRequest,
  })
  state.cursor = 0
  const form = CommitDialog()!
  state.values = []
  const render = () => {
    state.cursor = 0
    return elements((form.type as (props: unknown) => ReactNode)(form.props))
  }
  render()
  await Promise.resolve()
  return { result, render }
}
const submit = (tree: ReturnType<typeof elements>) => tree.find((node) => node.props.autoFocus && node.props.onClick)!

beforeEach(() => {
  state.values = []
  state.effects = []
  state.cursor = 0
  state.support = false
  state.invoke.mockResolvedValue({ branch: 'main', defaultBranch: 'main' })
})
afterEach(() => {
  for (const cleanup of state.effects) cleanup()
})

it('retains the requested PR when support finishes loading after the dialog opens', async () => {
  const { render, result } = await open(true)
  state.support = true
  const tree = render()
  expect(submit(tree).props.disabled).toBe(false)
  ;(submit(tree).props.onClick as () => void)()
  expect(await result).toMatchObject({
    pullRequest: true,
    action: 'push',
    branch: { expectedBranch: 'main', autoBranch: true },
  })
})

it('does not silently drop an explicit PR request while support is unavailable', async () => {
  const { render, result } = await open(true)
  ;(submit(render()).props.onClick as () => void)()
  expect(await result).toMatchObject({ pullRequest: true, action: 'push' })
})

it('lets the person explicitly switch the requested PR to push only', async () => {
  const { render, result } = await open(true)
  state.support = true
  const push = render().find((node) => node.props.children === 'Commit & Push')!
  ;(push.props.onClick as () => void)()
  ;(submit(render()).props.onClick as () => void)()
  expect(await result).toMatchObject({ pullRequest: false, action: 'push' })
})

it('keeps an ordinary push free of a PR when support finishes loading', async () => {
  const { render, result } = await open(false)
  state.support = true
  ;(submit(render()).props.onClick as () => void)()
  expect(await result).toMatchObject({ pullRequest: false, action: 'push' })
})
