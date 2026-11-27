import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ToolSuggestionView } from '@ramu/shared/toolSuggestions'
import { ToolSuggestionCard } from '../src/views/agent/components/ToolSuggestionCard'

const state = vi.hoisted(() => ({
  buttons: [] as ComponentProps<'button'>[],
  view: null as unknown,
  reviews: [] as unknown[][],
  skillReviews: [] as unknown[][],
  invoke: vi.fn(),
}))
vi.mock('../src/i18n', () => ({
  useLanguage: () => {},
  t: (text: string, values?: Record<string, unknown>) =>
    text.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key] ?? '')),
}))
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: state.view, refetch: vi.fn() }) }))
vi.mock('../src/workspace/HostProvider', () => ({ useHost: () => ({ id: 'local', invoke: state.invoke }) }))
vi.mock('../src/workspace/workspace', () => ({ useHostRuntime: () => ({ on: () => () => {} }) }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ preferences: { providerBinaries: {} } }) }))
vi.mock('../src/git/hostQuery', () => ({ queryInvokerFor: () => vi.fn() }))
vi.mock('../src/dataQueries', () => ({ ipcQueryKeyOn: (...key: unknown[]) => key }))
vi.mock('../src/ipc', () => ({ ramu: { invoke: vi.fn() } }))
vi.mock('../src/customize/parts', () => ({ brandOf: () => null }))
vi.mock('../src/customize/openCustomize', () => ({
  openCustomize: vi.fn(),
  reviewPluginInstall: (...args: unknown[]) => state.reviews.push(args),
  reviewSkillInstall: (...args: unknown[]) => state.skillReviews.push(args),
}))
vi.mock('@/components/brand-icon', () => ({ BrandIcon: () => null }))
vi.mock('@/components/desktop-button', () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<'button'> & { variant?: string; size?: string }) => {
    state.buttons.push(props)
    return createElement('button', props)
  },
}))

beforeEach(() => {
  state.buttons = []
  state.reviews = []
  state.skillReviews = []
})

const view = (overrides: Partial<ToolSuggestionView> = {}): ToolSuggestionView => ({
  card: {
    id: '00000000-0000-4000-8000-000000000001',
    sessionId: 'session',
    taskId: 'task',
    projectId: 'project-1',
    tool: { kind: 'plugin', index: 'https://github.com/akalstack/ramu-plugins', name: 'fly-cli' },
    title: 'Fly cli',
    description: 'flyctl with your saved token',
    signIn: false,
    reason: { kind: 'stack', stack: 'django' },
    dismissed: false,
    createdAt: 1,
  },
  status: { state: 'open' },
  canTurnOn: true,
  canAnswer: true,
  ...overrides,
})

const render = (value: ToolSuggestionView) => {
  state.view = value
  return renderToStaticMarkup(createElement(ToolSuggestionCard, { cardId: value.card.id }))
}
const labels = () => state.buttons.map((button) => String(button.children))

it('offers both ways to turn a tool on, and Not now, on the computer running the host', () => {
  const html = render(view())
  expect(labels()).toEqual(['Not now', 'Turn on everywhere', 'Turn on for this project'])
  expect(html).toContain('flyctl with your saved token')
  expect(html).toContain('This project uses Django.')
})

it('opens the plugin’s install review for this project, through Customize', () => {
  render(view())
  state.buttons[2]!.onClick?.({} as never)
  expect(state.reviews).toEqual([['https://github.com/akalstack/ramu-plugins', 'fly-cli', 'project-1']])
})

it('keeps Not now on another device and says where to turn the tool on', () => {
  const html = render(view({ canTurnOn: false }))
  expect(labels()).toEqual(['Not now'])
  expect(html).toContain('Change settings over an encrypted connection')
})

it('shows a viewer device the card without its buttons', () => {
  const html = render(view({ canAnswer: false }))
  expect(labels()).toEqual([])
  expect(html).toContain('Fly cli')
  expect(html).not.toContain('Change settings over an encrypted connection')
})

it('shows the tool is on once it is, and asks for a sign-in a server still needs', () => {
  expect(render(view({ status: { state: 'on' } }))).toContain('>On<')
  expect(labels()).toEqual([])
  const signIn = render(
    view({
      card: { ...view().card, tool: { kind: 'mcp', name: 'figma' }, title: 'Figma', signIn: true },
      status: { state: 'sign-in', connectionId: 'c1' },
    }),
  )
  expect(labels()).toEqual(['Sign in'])
  expect(signIn).toContain('Sign in to Figma to finish turning it on.')
})

it('shows the agent’s own reason, and opens a suggested skill’s review where the agent thinks it belongs', () => {
  const html = render(
    view({
      card: {
        ...view().card,
        tool: { kind: 'skill', source: 'acme/skills', name: 'release-notes' },
        title: 'release-notes',
        description: '',
        reason: { kind: 'agent', reason: 'It drafts release notes from commits.', scope: 'everywhere' },
      },
    }),
  )
  expect(html).toContain('Suggested by the agent: It drafts release notes from commits.')
  state.buttons[1]!.onClick?.({} as never)
  expect(state.skillReviews).toEqual([['acme/skills', 'release-notes', undefined]])
})
