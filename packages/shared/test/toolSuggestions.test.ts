import { describe, expect, it } from 'vitest'
import { CLAUDE_PLUGIN_INDEX, DEFAULT_PLUGIN_INDEX, type PluginListing } from '../src/plugins'
import { detectStack, linksIn, pluginForStack, reasonCopy, toolForLink, toolKey } from '../src/toolSuggestions'

const listing = (name: string, extra: Partial<PluginListing> = {}): PluginListing => ({
  index: DEFAULT_PLUGIN_INDEX,
  indexName: 'ramu-plugins',
  name,
  description: `${name} plugin`,
  source: `https://github.com/example/${name}`,
  commit: null,
  byRamu: false,
  signed: false,
  stacks: [],
  keywords: [],
  category: null,
  picture: null,
  installed: false,
  alternatives: [],
  companion: null,
  ...extra,
})
const link = (text: string) => toolForLink(new URL(text))

describe('links', () => {
  it('finds links in text, without the punctuation around them', () => {
    expect(
      linksIn('See https://www.figma.com/design/abc/Home?node-id=1, and (https://linear.app/acme/issue/A-1).').map(
        String,
      ),
    ).toEqual(['https://www.figma.com/design/abc/Home?node-id=1', 'https://linear.app/acme/issue/A-1'])
    expect(linksIn('no links here, just https:// and words')).toEqual([])
  })

  it('names the recommended server a service’s own link belongs to', () => {
    expect(link('https://www.figma.com/design/abc/Home')).toEqual({ tool: { kind: 'mcp', name: 'figma' } })
    expect(link('https://linear.app/acme/issue/ENG-12')).toEqual({ tool: { kind: 'mcp', name: 'linear' } })
    expect(link('https://acme.atlassian.net/browse/OPS-3')).toEqual({ tool: { kind: 'mcp', name: 'atlassian' } })
    expect(link('https://www.notion.so/acme/Plan-123')).toEqual({ tool: { kind: 'mcp', name: 'notion' } })
    expect(link('https://acme.sentry.io/issues/42/')).toEqual({ tool: { kind: 'mcp', name: 'sentry' } })
    expect(link('https://vercel.com/acme/shop/deployments')).toEqual({ tool: { kind: 'mcp', name: 'vercel' } })
  })

  it('leaves out a service’s own pages that say nothing about the work', () => {
    expect(link('https://www.figma.com/pricing/')).toBeNull()
    expect(link('https://vercel.com/docs/functions')).toBeNull()
    expect(link('https://notfigma.com/design/abc')).toBeNull()
    expect(link('https://example.com/?next=https://figma.com/design/x')).toBeNull()
  })

  it('points a GitHub issue or pull request at its plugin, unless Ramu is signed in to GitHub', () => {
    expect(link('https://github.com/acme/shop/pull/12')).toEqual({
      tool: { kind: 'plugin', index: CLAUDE_PLUGIN_INDEX, name: 'github' },
      unlessSignedIn: 'github',
    })
    expect(link('https://github.com/acme/shop')).toBeNull()
  })
})

describe('stacks', () => {
  it('takes the stack ramu.json names, then what the root files show', () => {
    expect(detectStack({ configured: 'rails', files: ['package.json'], manifests: {} })).toBe('rails')
    expect(
      detectStack({
        files: ['package.json'],
        manifests: { 'package.json': JSON.stringify({ dependencies: { next: '15', react: '19' } }) },
      }),
    ).toBe('nextjs')
    expect(
      detectStack({
        files: ['package.json'],
        manifests: { 'package.json': '{"devDependencies":{"vite":"6","react":"19"}}' },
      }),
    ).toBe('vite-react')
    expect(detectStack({ files: ['manage.py'], manifests: {} })).toBe('django')
    expect(
      detectStack({
        files: ['pyproject.toml'],
        manifests: { 'pyproject.toml': 'dependencies = ["fastapi[standard]"]' },
      }),
    ).toBe('fastapi')
    expect(detectStack({ files: ['Gemfile'], manifests: { Gemfile: "gem 'rails', '~> 8'" } })).toBe('rails')
    expect(detectStack({ files: ['go.mod'], manifests: {} })).toBe('go')
    expect(detectStack({ files: ['README.md'], manifests: { 'package.json': 'not json' } })).toBeNull()
  })

  it('suggests a stack’s plugin only when exactly one isn’t installed', () => {
    const vercel = listing('vercel', { stacks: ['nextjs'] })
    expect(pluginForStack([vercel, listing('other')], 'nextjs')?.name).toBe('vercel')
    expect(pluginForStack([vercel, listing('netlify', { stacks: ['nextjs'] })], 'nextjs')).toBeNull()
    expect(pluginForStack([{ ...vercel, installed: true }], 'nextjs')).toBeNull()
  })
})

it('says why a tool is suggested in words both apps translate, the agent’s own reason included', () => {
  expect(reasonCopy({ kind: 'link', host: 'www.figma.com' })).toEqual({
    text: 'This thread links to {0}.',
    values: { 0: 'www.figma.com' },
  })
  expect(reasonCopy({ kind: 'stack', stack: 'nextjs' }).values).toEqual({ 0: 'Next.js' })
  expect(reasonCopy({ kind: 'agent', reason: 'It reads your Sentry errors.', scope: 'project' })).toEqual({
    text: 'Suggested by the agent: {0}',
    values: { 0: 'It reads your Sentry errors.' },
  })
})

it('keys a skill by its repository too, so two repositories’ skills of one name stay apart', () => {
  expect(toolKey({ kind: 'skill', source: 'acme/skills', name: 'deploy' })).toBe('skill:acme/skills/deploy')
  expect(toolKey({ kind: 'plugin', index: DEFAULT_PLUGIN_INDEX, name: 'fly-cli' })).toBe('plugin:fly-cli')
})
