import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import type { ProviderCatalog } from '@ramu/shared/types'
import { projectAgentDefaults } from '../src/workspace/projectAgentDefaults'
import { loadProjectConfig } from '../src/workspace/projectConfig'
import { createDispatcher, type Services } from '../src/ipc'
import { Workspace } from '../src/workspace/workspace'
import { openDb } from '../src/db'
const cleanup: (() => void)[] = []
afterEach(() => {
  for (const dispose of cleanup.splice(0).reverse()) dispose()
})
const catalog: ProviderCatalog[] = ['codex', 'claude-code'].map((provider) => ({
  provider: provider as ProviderCatalog['provider'],
  models: [
    {
      provider: provider as ProviderCatalog['provider'],
      id: `${provider}-default`,
      name: 'Default',
      efforts: ['low', 'high'],
      defaultEffort: 'low',
      isDefault: true,
    },
  ],
}))
it('uses exact identities from the eligible host catalog and binds model-only preferences to the host default provider', async () => {
  const discover = vi.fn(async () => catalog)
  expect(await projectAgentDefaults({ config: {}, source: 'ramu.json' }, 'codex', discover)).toEqual({
    status: 'none',
    source: 'ramu.json',
  })
  expect(discover).not.toHaveBeenCalled()
  expect(
    await projectAgentDefaults(
      { config: { agent: { preferredProvider: 'claude-code' } }, source: 'ramu.json' },
      'codex',
      discover,
    ),
  ).toMatchObject({
    status: 'ready',
    source: 'ramu.json',
    selection: { provider: 'claude-code', model: 'claude-code-default', effort: 'low' },
  })
  const config = { agent: { preferredModel: 'codex-default' } }
  expect(await projectAgentDefaults({ config }, 'codex', discover)).toMatchObject({
    status: 'ready',
    selection: { provider: 'codex' },
  })
  expect(await projectAgentDefaults({ config }, 'claude-code', discover)).toMatchObject({
    status: 'unavailable',
    reason: 'model',
  })
})
it('reports disabled, unsupported, failed and unknown model choices without selecting another provider', async () => {
  const config = { agent: { preferredProvider: 'codex', preferredModel: 'codex-default' } }
  expect(
    await projectAgentDefaults({ config }, 'claude-code', async () =>
      catalog.filter((entry) => entry.provider !== 'codex'),
    ),
  ).toMatchObject({ status: 'unavailable', reason: 'provider' })
  expect(
    await projectAgentDefaults(
      { config: { agent: { preferredProvider: 'future-provider' } } },
      'codex',
      async () => catalog,
    ),
  ).toMatchObject({ status: 'unavailable', reason: 'provider' })
  expect(
    await projectAgentDefaults(
      { config: { agent: { preferredProvider: 'codex', preferredModel: 'unknown' } } },
      'codex',
      async () => catalog,
    ),
  ).toMatchObject({ status: 'unavailable', reason: 'model' })
  expect(
    await projectAgentDefaults({ config }, 'codex', async () => {
      throw Error('Provider authentication failed')
    }),
  ).toMatchObject({ status: 'unavailable', reason: 'catalog' })
  expect(
    await projectAgentDefaults({ config }, 'codex', async () => [{ ...catalog[0]!, error: 'Stale catalog' }]),
  ).toMatchObject({ status: 'unavailable', reason: 'catalog' })
  const discover = vi.fn(async () => catalog)
  expect(
    await projectAgentDefaults({ config: {}, error: 'Invalid config', source: 'ramu.json' }, 'codex', discover),
  ).toEqual({ status: 'invalid', source: 'ramu.json' })
  expect(discover).not.toHaveBeenCalled()
})
it('exposes only model preferences through the typed handler and does not mutate settings, allocate work or execute configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-agent-defaults-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(
    join(dir, 'ramu.json'),
    JSON.stringify({
      agent: {
        preferredProvider: 'codex',
        preferredModel: 'codex-default',
        access: 'full',
        apiKey: 'secret',
        binary: '/unsafe',
        accountId: 'private',
      },
    }),
  )
  expect(loadProjectConfig(dir).config.agent).toEqual({ preferredProvider: 'codex', preferredModel: 'codex-default' })
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, join(dir, 'worktrees'))
  const { project } = await workspace.addProjectFromFolder(dir)
  const discover = vi.fn(async () => catalog)
  const dispatcher = createDispatcher({ userData: dir, send() {}, native: async () => null }, {
    workspace,
    agents: { catalog: discover },
  } as unknown as Services)
  cleanup.push(() => dispatcher.close())
  const before = readSettings()
  function readSettings() {
    return workspace.getAppState('app-preferences', null)
  }
  expect(await dispatcher.invoke('tasks.agentDefaults', [project.id, 'claude-code'])).toMatchObject({
    status: 'ready',
    selection: { provider: 'codex', model: 'codex-default' },
  })
  expect(workspace.listTasks()).toEqual([])
  expect(workspace.listWorkspaces()).toEqual([])
  expect(readSettings()).toEqual(before)
  writeFileSync(join(dir, 'ramu.json'), JSON.stringify({ agent: { preferredModel: 'claude-code-default' } }))
  expect(await dispatcher.invoke('tasks.agentDefaults', [project.id, 'claude-code'])).toMatchObject({
    status: 'ready',
    selection: { provider: 'claude-code' },
  })
  await expect(dispatcher.invoke('tasks.agentDefaults', ['missing', 'codex'])).rejects.toThrow()
  expect(() => dispatcher.invoke('tasks.agentDefaults', [project.id, 'future-provider'])).toThrow()
})

it('rereads a changed repository preference after asynchronous catalog discovery without starting another discovery', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-agent-default-race-'))
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(join(dir, 'ramu.json'), JSON.stringify({ agent: { preferredProvider: 'codex' } }))
  const db = openDb(':memory:')
  cleanup.push(() => db.close())
  const workspace = new Workspace(db, join(dir, 'worktrees'))
  const { project } = await workspace.addProjectFromFolder(dir)
  let resolve!: (value: ProviderCatalog[]) => void
  const discover = vi.fn(
    () =>
      new Promise<ProviderCatalog[]>((done) => {
        resolve = done
      }),
  )
  const dispatcher = createDispatcher({ userData: dir, send() {}, native: async () => null }, {
    workspace,
    agents: { catalog: discover },
  } as unknown as Services)
  cleanup.push(() => dispatcher.close())
  const pending = dispatcher.invoke('tasks.agentDefaults', [project.id, 'codex'])
  writeFileSync(join(dir, 'ramu.json'), JSON.stringify({ agent: { preferredProvider: 'claude-code' } }))
  resolve(catalog)
  expect(await pending).toMatchObject({
    status: 'ready',
    requested: { provider: 'claude-code' },
    selection: { provider: 'claude-code', model: 'claude-code-default' },
  })
  expect(discover).toHaveBeenCalledTimes(1)
})
