import { createElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { beforeEach, expect, it, vi } from 'vitest'
import { NO_PROJECT } from '@ramu/shared/types'
import { useIdentityView } from '../src/sidebar/identityView'

const state = vi.hoisted(() => ({ view: 'all' }))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useState: () => [state.view, vi.fn()],
}))
vi.mock('../src/i18n', () => ({
  t: (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? '')),
}))
vi.mock('../src/Menu', () => ({ Menu: () => null }))
vi.mock('@/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('../src/settings/IdentityChip', () => ({ IdentityDot: () => null }))
vi.mock('../src/workspace/identities', () => ({
  useIdentities: () => ({
    settings: {
      identities: [
        { id: 'work', name: 'Work', color: 'blue', isDefault: false },
        { id: 'home', name: 'Home', color: 'violet', isDefault: true },
      ],
    },
    projects: [
      { projectId: 'shop', identityId: 'work' },
      { projectId: 'blog', identityId: 'home' },
    ],
  }),
}))

// Recent threads in recency order: the newest is in Shop, then a thread in no project, then Blog, then Shop again.
const threads = [
  { id: 'a', projectId: 'shop' },
  { id: 'b', projectId: NO_PROJECT },
  { id: 'c', projectId: 'blog' },
  { id: 'd', projectId: 'shop' },
]
const flat = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(flat)
  if (!isValidElement<Record<string, unknown>>(node)) return []
  return [node, ...flat(node.props.children as ReactNode)]
}
const texts = (node: ReactNode): string[] =>
  Array.isArray(node)
    ? node.flatMap(texts)
    : typeof node === 'string' || typeof node === 'number'
      ? [String(node)]
      : isValidElement<{ children?: ReactNode }>(node)
        ? texts(node.props.children)
        : []
const useArranged = () =>
  useIdentityView('local').arrange(
    threads,
    (thread) => thread.projectId,
    (thread) => createElement('i', { key: thread.id }, thread.id),
  )

beforeEach(() => {
  state.view = 'all'
})

it('narrows recent threads to one identity, keeping a thread in no project with the default identity', () => {
  state.view = 'only:home'
  const out = useArranged()
  expect(
    flat(out)
      .filter((node) => node.type === 'i')
      .map((node) => node.key),
  ).toEqual(['b', 'c'])
  expect(texts(out).join('')).toContain('Showing only Home: 2 more hidden')
  state.view = 'only:work'
  expect(
    flat(useArranged())
      .filter((node) => node.type === 'i')
      .map((node) => node.key),
  ).toEqual(['a', 'd'])
})

it('groups recent threads under identity headings, in recency order within each', () => {
  state.view = 'group'
  const order = texts(useArranged())
  expect(order.join(' ')).toBe('Work 2 a d Home 2 b c')
})
