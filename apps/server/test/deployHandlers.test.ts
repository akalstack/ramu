import { expect, it, vi } from 'vitest'
import { registerDeployHandlers } from '../src/ipc/handlers/deploy'
import { latestDeployChecks } from '../src/workspace/deploy/gitHostStatus'

vi.mock('../src/workspace/deploy/gitHostStatus', () => ({ latestDeployChecks: vi.fn() }))

const setup = (local: boolean) => {
  const migrations = { plan: vi.fn(), save: vi.fn(async () => {}), remove: vi.fn(async () => {}) }
  const uptime = { status: vi.fn(), setEnabled: vi.fn(), setAddress: vi.fn(() => ({ address: 'https://shop.id' })) }
  const methods = registerDeployHandlers({
    host: { canAdministerIntegrations: () => local },
    migrations,
    uptime,
    workspace: {
      listProjects: () => [{ id: 'p1', name: 'Shop' }],
      listRepositories: () => [
        { id: 'r1', name: 'shop', root: '/tmp/shop' },
        { id: 'r2', name: 'notes', root: '/tmp/notes' },
      ],
      projectConfiguration: () => ({ config: { stack: { deployTarget: 'vercel' } } }),
    },
  } as never)
  return { methods, migrations, uptime }
}

it('saves the production database address only on the host itself', async () => {
  const { methods, migrations } = setup(false)
  expect(() => methods['deploy.setProductionDatabase']!.run('p1', 'postgres://u:p@db/x')).toThrow('host running Ramu')
  expect(migrations.save).not.toHaveBeenCalled()
  const host = setup(true)
  await host.methods['deploy.setProductionDatabase']!.run('p1', 'postgres://u:p@db/x')
  expect(host.migrations.save).toHaveBeenCalledWith('p1', 'postgres://u:p@db/x')
  await host.methods['deploy.setProductionDatabase']!.run('p1', null)
  expect(host.migrations.remove).toHaveBeenCalledWith('p1')
})

it('bounds every input and refuses an unknown project', () => {
  const { methods, uptime } = setup(true)
  const args = (method: string, value: unknown[]) => methods[method]!.args.safeParse(value).success
  expect(args('deploy.setLiveAddress', ['p1', 'https://shop.id'])).toBe(true)
  expect(args('deploy.setLiveAddress', ['p1', null])).toBe(true)
  expect(args('deploy.setLiveAddress', ['p1', 'ftp://shop.id'])).toBe(false)
  expect(args('deploy.setLiveAddress', ['p1', `https://${'x'.repeat(2000)}.id`])).toBe(false)
  expect(args('deploy.setProductionDatabase', ['p1', 'not an address'])).toBe(false)
  expect(() => methods['deploy.setLiveAddress']!.run('other', 'https://shop.id')).toThrow('not on this host')
  expect(methods['deploy.setLiveAddress']!.run('p1', 'https://shop.id')).toEqual({ address: 'https://shop.id' })
  expect(uptime.setAddress).toHaveBeenCalledWith('p1', 'https://shop.id')
})

it('reads the latest deploy from the Git host for each repository it can read, with the stack’s platform', async () => {
  const checks = {
    repoId: 'r1',
    name: 'shop',
    branch: 'main',
    commit: 'a'.repeat(40),
    checks: [{ name: 'Vercel', state: 'success' as const, url: 'https://vercel.com/me/shop/1' }],
  }
  vi.mocked(latestDeployChecks).mockImplementation(async (repository) => (repository.id === 'r1' ? checks : null))
  const { methods } = setup(false)
  expect(await methods['deploy.status']!.run('p1')).toEqual({ recommended: 'vercel', repositories: [checks] })
})
