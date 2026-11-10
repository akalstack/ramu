import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { CLAUDE_PLUGIN_INDEX, DEFAULT_PLUGIN_INDEX } from '@ramu/shared/plugins'
import { PluginService, type PluginHost } from '../src/plugins/service'

const temp = () => mkdtempSync(join(tmpdir(), 'ramu-companions-'))
function index(name: string, plugins: unknown[]) {
  const dir = temp()
  mkdirSync(join(dir, '.claude-plugin'))
  writeFileSync(join(dir, '.claude-plugin', 'marketplace.json'), JSON.stringify({ name, plugins }))
  return dir
}
const folders: Record<string, string> = {
  [DEFAULT_PLUGIN_INDEX]: index('ramu-plugins', [
    {
      name: 'railway-cli',
      source: './plugins/railway-cli',
      extensions: { 'dev.getramu': { byRamu: true, companion: 'railway' } },
    },
  ]),
  [CLAUDE_PLUGIN_INDEX]: index('claude-plugins-official', [
    { name: 'railway', source: { source: 'url', url: 'https://github.com/railwayapp/railway-skills.git' } },
    { name: 'linear', source: './external_plugins/linear', category: 'productivity' },
  ]),
}
vi.mock('../src/plugins/source', async (original) => ({
  ...(await original<typeof import('../src/plugins/source')>()),
  fetchGitSource: async (_parent: string, url: string) => ({
    dir: folders[url]!,
    commit: 'a'.repeat(40),
    cleanup: async () => {},
  }),
}))

it('pairs a Ramu plugin with the service’s own plugin in Claude’s directory, both ways', async () => {
  const state = new Map<string, unknown>()
  const service = new PluginService({
    getState: (key: string, fallback: unknown) => (state.has(key) ? state.get(key) : fallback),
    setState: (key: string, value: unknown) => void state.set(key, value),
    dir: temp(),
    ramuVersion: '0.2.0',
    mcp: { connections: () => [] },
  } as unknown as PluginHost)
  const listings = await service.browse()
  const named = (name: string) => listings.find((listing) => listing.name === name)
  expect(named('railway-cli')?.companion).toEqual({ index: CLAUDE_PLUGIN_INDEX, name: 'railway' })
  expect(named('railway')?.companion).toEqual({ index: DEFAULT_PLUGIN_INDEX, name: 'railway-cli' })
  expect(named('linear')).toMatchObject({ companion: null, category: 'productivity' })
})
