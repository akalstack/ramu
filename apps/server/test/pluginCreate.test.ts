import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstalledPlugin, PluginReview } from '@ramu/shared/plugins'
import { ToolRegistry } from '../src/agent/toolRegistry'
import { registerPluginTools } from '../src/plugins/tools'

const folders: string[] = []
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true })
})

function setup(approve = true) {
  const drafts = realpathSync(mkdtempSync(join(tmpdir(), 'ramu-drafts-')))
  folders.push(drafts)
  const review = {
    stageId: 'stage-1',
    blocked: null,
    changes: [],
    byRamu: false,
    source: { location: join(drafts, 'rodin-3d'), path: null, commit: null, signedBy: null },
    contents: {
      name: 'rodin-3d',
      author: null,
      description: 'Rodin 3D models',
      license: null,
      skills: [],
      mcpServers: [],
      agents: [],
      rule: null,
      credentials: [],
      cli: null,
      abilities: [],
      unused: [],
    },
  } as unknown as PluginReview
  const plugins = {
    browse: vi.fn(async () => []),
    list: vi.fn(() => []),
    stage: vi.fn(async () => review),
    cancel: vi.fn(async () => {}),
    confirm: vi.fn(
      async () =>
        ({
          id: 'p1',
          credentials: [{ id: 'token', label: 'Rodin API key', state: 'missing' }],
        }) as unknown as InstalledPlugin,
    ),
  }
  const approval = vi.fn(async (_detail: string) => approve)
  const installed = vi.fn()
  const registry = new ToolRegistry(new McpServer({ name: 'test', version: '1' }), true)
  registerPluginTools(registry.server, plugins, approval, installed, () => drafts)
  const extra = { signal: new AbortController().signal } as Parameters<typeof registry.invoke>[2]
  const call = async (args: Record<string, unknown>) => {
    const result = await registry.invoke('plugin_create', args, extra)
    const text = (result.content as { text: string }[])[0]!.text
    return { isError: !!result.isError, text, value: result.isError ? null : JSON.parse(text) }
  }
  return { drafts, plugins, approval, installed, call }
}

describe('plugin_create', () => {
  it('starts a folder, checks it and installs it as a Development plugin through the review card', async () => {
    const { drafts, plugins, approval, installed, call } = setup()
    const started = await call({ name: 'rodin-3d', step: 'start', mcp: false })
    expect(started.value.folder).toBe(join(drafts, 'rodin-3d'))
    const checked = await call({ name: 'rodin-3d', step: 'check' })
    expect(checked.value).toMatchObject({ passed: true, problems: [] })
    const done = await call({ name: 'rodin-3d', step: 'install' })
    expect(plugins.stage).toHaveBeenCalledWith({ source: join(drafts, 'rodin-3d') })
    expect(approval.mock.calls[0]![0]).toContain('Install the rodin-3d plugin')
    expect(plugins.confirm).toHaveBeenCalledWith('stage-1', {
      scope: { kind: 'all' },
      includeScripts: false,
      development: true,
      offerAbilities: true,
    })
    expect(installed).toHaveBeenCalledWith('p1')
    // The key goes on the card; the agent is told to ask for it there.
    expect(done.value.next).toContain('add Rodin API key for rodin-3d in Customize → Plugins')
  })

  it('refuses to install a folder with problems or one the person declined', async () => {
    const { call, plugins } = setup(false)
    expect((await call({ name: 'rodin-3d', step: 'install' })).text).toContain('Call plugin_create with step "start"')
    await call({ name: 'rodin-3d', step: 'start', mcp: false })
    const declined = await call({ name: 'rodin-3d', step: 'install' })
    expect(declined.isError).toBe(true)
    expect(declined.text).toContain('declined')
    expect(plugins.cancel).toHaveBeenCalledWith('stage-1')
  })
})
