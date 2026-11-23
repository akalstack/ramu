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
const MESHY = 'https://github.com/meshy-dev/meshy-3d-agent'
/** Meshy's own marketplace, which lists its plugin under another name than its manifest's. */
function meshyIndex() {
  const dir = index('meshy-3d-agent', [{ name: 'meshy-3d-generation', source: './' }])
  writeFileSync(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'meshy-3d-agent', version: '1.0.0' }),
  )
  mkdirSync(join(dir, 'skills', 'meshy-3d'), { recursive: true })
  writeFileSync(
    join(dir, 'skills', 'meshy-3d', 'SKILL.md'),
    '---\nname: meshy-3d\ndescription: Make 3D models with Meshy.\n---\n\nUse Meshy.\n',
  )
  return dir
}
const folders: Record<string, string> = {
  [DEFAULT_PLUGIN_INDEX]: index('ramu-plugins', [
    {
      name: 'grafana-data',
      source: './plugins/grafana-data',
      extensions: { 'dev.getramu': { byRamu: true, companion: 'grafana-mcp' } },
    },
    {
      name: 'meshy',
      source: './plugins/meshy',
      extensions: { 'dev.getramu': { byRamu: true, companionFrom: { name: 'meshy-3d-generation', index: MESHY } } },
    },
  ]),
  [MESHY]: meshyIndex(),
  [CLAUDE_PLUGIN_INDEX]: index('claude-plugins-official', [
    { name: 'grafana-mcp', source: { source: 'url', url: 'https://github.com/grafana/mcp-grafana.git' } },
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
  expect(named('grafana-data')?.companion).toEqual({ index: CLAUDE_PLUGIN_INDEX, name: 'grafana-mcp' })
  expect(named('grafana-mcp')?.companion).toEqual({ index: DEFAULT_PLUGIN_INDEX, name: 'grafana-data' })
  expect(named('linear')).toMatchObject({ companion: null, category: 'productivity' })
})

it('counts a companion as installed once it is installed from its listing under another name than its manifest’s', async () => {
  const state = new Map<string, unknown>()
  const service = new PluginService({
    getState: (key: string, fallback: unknown) => (state.has(key) ? structuredClone(state.get(key)) : fallback),
    setState: (key: string, value: unknown) => void state.set(key, structuredClone(value)),
    dir: temp(),
    ramuVersion: '0.2.0',
    skills: { list: () => [], write: () => {}, remove: () => {} },
    mcp: { connections: () => [], save: () => ({}), remove: () => {}, setSecret: async () => {} },
    agents: { list: () => [], save: () => ({}), remove: () => {} },
    rules: { save: () => ({ id: 'r' }), remove: () => {} },
    projects: () => [],
    changed: () => {},
  } as unknown as PluginHost)
  const review = await service.stage({ source: 'meshy-3d-generation', index: MESHY })
  expect(review.blocked).toBeNull()
  const installed = await service.confirm(review.stageId, { scope: { kind: 'all' } })
  expect(installed.name).toBe('meshy-3d-agent')
  // Ramu's Meshy plugin names the companion by its listing, and its card finds it installed under the manifest's name.
  const ramu = temp()
  mkdirSync(join(ramu, '.claude-plugin'))
  writeFileSync(
    join(ramu, '.claude-plugin', 'plugin.json'),
    JSON.stringify({
      name: 'meshy',
      version: '1.0.0',
      extensions: { 'dev.getramu': { companionFrom: { name: 'meshy-3d-generation', index: MESHY } } },
    }),
  )
  writeFileSync(join(ramu, 'AGENTS.md'), 'Make models with make_model.\n')
  const meshy = await service.confirm((await service.stage({ source: ramu })).stageId, { scope: { kind: 'all' } })
  expect(meshy.companion).toEqual({ index: MESHY, name: 'meshy-3d-generation', installed: true })
})
