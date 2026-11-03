import { createElement, type ReactNode, isValidElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  values: [] as unknown[],
  index: 0,
  effects: [] as (() => unknown)[],
  list: null as unknown,
  invoke: vi.fn(),
}))
vi.mock('react', async (original) => ({
  ...(await original<typeof import('react')>()),
  useId: () => 'suggestions',
  useMemo: (run: () => unknown) => run(),
  useRef: (initial: unknown) => ({ current: state.list ?? initial }),
  useState(initial: unknown) {
    const index = state.index++
    if (!(index in state.values)) state.values[index] = initial
    return [
      state.values[index],
      (next: unknown) => {
        state.values[index] = typeof next === 'function' ? next(state.values[index]) : next
      },
    ]
  },
  useEffect: (run: () => unknown) => state.effects.push(run),
}))
vi.mock('../src/i18n', () => ({ t: (s: string) => s, useLanguage() {} }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ invoke: state.invoke }) }))
vi.mock('../src/workspace/workspace', () => ({
  useWorkspace: () => ({ ui: {}, repos: { p: [{ id: 'repo', name: 'project' }] } }),
}))
vi.mock('../src/settings/AppSettings', () => ({
  useAppSettings: () => ({ preferences: { memory: { enabled: false }, intelligence: { learning: 'off' } } }),
}))
vi.mock('../src/editor/editorBuffers', () => ({ readBuffer() {}, readSelection() {} }))
vi.mock('../src/chat/Notifications', () => ({ notifyError() {} }))
vi.mock('../src/git/reviews', () => ({ openReview() {} }))
vi.mock('../src/components/desktop-button', () => ({ Button: 'button' }))
vi.mock('../src/components/ui/badge', () => ({ Badge: 'span' }))
import { ComposerSuggestions, useComposerSuggestions, type ComposerTeammate } from '../src/composer/ComposerSuggestions'

beforeEach(() => {
  state.values = []
  state.effects = []
  state.index = 0
  state.list = null
  state.invoke.mockReset()
})
function RenderSuggestions(value: string, team?: ComposerTeammate) {
  state.index = 0
  return useComposerSuggestions(value, value.length, 'task', true, team)
}
async function load(value: string, team?: ComposerTeammate) {
  RenderSuggestions(value, team)
  state.effects.splice(0).forEach((run) => run())
  for (let i = 0; i < 8; i++) await Promise.resolve()
  return RenderSuggestions(value, team)
}

it('loads file suggestions without requiring skills and preserves full paths on insertion', async () => {
  const path = `${'long-directory/'.repeat(15)}a file.ts`
  state.invoke.mockImplementation(async (method) => {
    if (method === 'files.all') return [{ repoId: 'repo', path }]
    throw new Error('Skills unavailable')
  })
  const suggestions = await load('@')
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('files.all', 'task')
  expect(suggestions.loadError).toBeNull()
  expect(suggestions.choices).toHaveLength(1)
  expect(suggestions.choose(suggestions.choices[0]!).value).toBe(`@"project/${path}" `)
  const html = renderToStaticMarkup(createElement(ComposerSuggestions, { suggestions, onChoose() {} }))
  expect(html).toContain('>a file.ts</strong>')
  expect(html).toContain(`title="project/${path}"`)
  expect(html).toContain(`project/${path}</span>`)
})

it('loads slash skills without scanning files and keeps long skill text constrained', async () => {
  state.invoke.mockResolvedValue([{ name: 'review', path: '/skill', description: 'Detailed review '.repeat(100) }])
  const suggestions = await load('/review')
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('skills.list', 'task')
  const html = renderToStaticMarkup(createElement(ComposerSuggestions, { suggestions, onChoose() {} }))
  expect(html).toContain('>/review</strong>')
  expect(html).toContain('Detailed review ')
  expect(html).toContain('block truncate')
})

it('lists only skills after $ and inserts the skill reference', async () => {
  state.invoke.mockResolvedValue([{ name: 'review', path: '/skill', description: 'Review changes' }])
  const suggestions = await load('please $rev')
  expect(state.invoke).toHaveBeenCalledExactlyOnceWith('skills.list', 'task')
  expect(suggestions.visible).toBe(true)
  expect(suggestions.choices.map((choice) => choice.label)).toEqual(['$review'])
  expect(suggestions.choose(suggestions.choices[0]!).value).toBe('please $review ')
})

it('keeps $ as plain text when no skill matches', async () => {
  state.invoke.mockResolvedValue([{ name: 'review', path: '/skill', description: 'Review changes' }])
  expect((await load('costs $5')).visible).toBe(false)
  expect(state.invoke).not.toHaveBeenCalled()
  expect((await load('echo $HOME')).visible).toBe(false)
})

it('shows file loading failures and no stale file choices', async () => {
  state.invoke.mockRejectedValue(new Error('Host disconnected'))
  const suggestions = await load('@')
  expect(suggestions.loadError).toBe('Host disconnected')
  expect(suggestions.loading).toBe(false)
  expect(suggestions.choices).toEqual([])
})

it('scrolls the selected option inside the dropdown without moving ancestor scrollers', () => {
  const suggestions = RenderSuggestions('@')
  const option = { getBoundingClientRect: () => ({ top: 350 }), offsetHeight: 50, scrollIntoView: vi.fn() }
  const list = { getBoundingClientRect: () => ({ top: 100 }), clientTop: 1, clientHeight: 200, scrollTop: 0 }
  state.list = list
  vi.stubGlobal('document', { getElementById: () => option })
  state.effects = []
  ComposerSuggestions({ suggestions, onChoose() {} })
  state.effects.forEach((run) => run())
  expect(list.scrollTop).toBe(99)
  expect(option.scrollIntoView).not.toHaveBeenCalled()
  vi.unstubAllGlobals()
})

it('keeps focus in the composer when clicking an option and chooses its original index', () => {
  const suggestions = RenderSuggestions('/')
  const onChoose = vi.fn()
  function findOption(node: ReactNode): Record<string, unknown> | undefined {
    if (Array.isArray(node)) return node.map(findOption).find(Boolean)
    if (!isValidElement<Record<string, unknown>>(node)) return
    if (node.props.role === 'option') return node.props
    return findOption(node.props.children as ReactNode)
  }
  const option = findOption(ComposerSuggestions({ suggestions, onChoose }))!
  const preventDefault = vi.fn()
  ;(option.onMouseDown as (event: unknown) => void)({ preventDefault })
  ;(option.onClick as () => void)()
  expect(preventDefault).toHaveBeenCalledOnce()
  expect(onChoose).toHaveBeenCalledWith(0)
})

it('offers the teammate first after @ at the start of a message, and inserts its handle', async () => {
  state.invoke.mockResolvedValue([{ repoId: 'repo', path: 'codex.ts' }])
  const team = { current: { name: 'GPT Sol', mode: 'review' as const } }
  const suggestions = await load('@gpt', team)
  expect(suggestions.choices.map((choice) => [choice.label, choice.kind])).toEqual([['@gpt-sol', 'Teammate']])
  expect(suggestions.choose(suggestions.choices[0]!).value).toBe('@gpt-sol ')
  // Mid-message the mention would not reach the teammate, so only files are offered there.
  const later = await load('look at @co', team)
  expect(later.choices.map((choice) => choice.kind)).toEqual(['File'])
})

it('offers Add teammate after @ and as /teammate when the thread has none', async () => {
  state.invoke.mockResolvedValue([])
  const onAdd = vi.fn()
  const at = await load('@', { onAdd })
  expect(at.choices.map((choice) => choice.label)).toEqual(['Add teammate'])
  expect(at.choose(at.choices[0]!).value).toBe('')
  expect(onAdd).toHaveBeenCalledOnce()
  const slash = await load('/teammate', { onAdd })
  expect(slash.choices.map((choice) => choice.label)).toContain('/teammate')
  // A device that may only view gets neither.
  expect((await load('/teammate')).choices.map((choice) => choice.label)).not.toContain('/teammate')
})
