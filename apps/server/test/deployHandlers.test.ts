import { expect, it, vi } from 'vitest'
import { registerDeployHandlers } from '../src/ipc/handlers/deploy'
import { KeyedLock } from '../src/ipc/keyedLock'

const setup = (local: boolean, device: { id: string; owner: boolean } | null = null) => {
  const deploys = {
    accounts: { save: vi.fn(async () => ({})), disconnect: vi.fn(), list: vi.fn(async () => []) },
    signIns: { start: vi.fn(() => ({})) },
    service: { link: vi.fn(async () => ({})), deploy: vi.fn(async () => ({})), project: vi.fn(async () => ({})) },
    preview: vi.fn(async () => null),
  }
  const methods = registerDeployHandlers({
    host: {
      canAdministerIntegrations: () => local,
      browserDevice: () => (device ? device.id : 'local'),
      browserGrantEligible: () => !!device?.owner,
    },
    lock: new KeyedLock(),
    deploys,
    workspace: { listProjects: () => [{ id: 'p1', name: 'My Shop!' }] },
    gitCwdOf: (taskId: string, repoId: string) => {
      if (taskId !== 't1' || repoId !== 'r1') throw new Error('This thread has no such repository.')
      return '/tmp/shop'
    },
  } as never)
  return { methods, deploys }
}

it('changes hosting accounts only on the host itself', async () => {
  const { methods, deploys } = setup(false)
  expect(() => methods['deploy.saveToken']!.run('vercel', 'tok_12345678')).toThrow('host running Ramu')
  expect(() => methods['deploy.signIn']!.run('netlify')).toThrow('host running Ramu')
  await expect(methods['deploy.disconnect']!.run('vercel')).rejects.toThrow('host running Ramu')
  expect(deploys.accounts.save).not.toHaveBeenCalled()
  expect(await methods['deploy.accounts']!.run(false)).toEqual({ accounts: [], canAdminister: false })
})

it('lets a paired owner device start a sign-in whose link opens anywhere, and nothing else', () => {
  const owner = setup(false, { id: 'phone', owner: true })
  owner.methods['deploy.signIn']!.run('vercel')
  expect(owner.deploys.signIns.start).toHaveBeenCalledWith('vercel')
  // Fly.io's sign-in opens a browser on the host, and tokens are pasted only there.
  expect(() => owner.methods['deploy.signIn']!.run('fly')).toThrow('host running Ramu')
  expect(() => owner.methods['deploy.saveToken']!.run('vercel', 'tok_12345678')).toThrow('host running Ramu')
  const viewer = setup(false, { id: 'tablet', owner: false })
  expect(() => viewer.methods['deploy.signIn']!.run('vercel')).toThrow('host running Ramu')
})

it('bounds every input and refuses an unknown platform or project', async () => {
  const { methods, deploys } = setup(true)
  const args = (method: string, value: unknown[]) => methods[method]!.args.safeParse(value).success
  expect(args('deploy.saveToken', ['vercel', 'tok_12345678'])).toBe(true)
  expect(args('deploy.saveToken', ['heroku', 'tok_12345678'])).toBe(false)
  expect(args('deploy.saveToken', ['vercel', 'short'])).toBe(false)
  expect(args('deploy.saveToken', ['vercel', 'two words here'])).toBe(false)
  expect(args('deploy.saveToken', ['vercel', 'x'.repeat(4001)])).toBe(false)
  expect(args('deploy.signInStatus', ['not-a-uuid'])).toBe(false)
  expect(args('deploy.logs', ['p1', 'x'.repeat(201)])).toBe(false)
  expect(args('deploy.addDomain', ['p1', 'www.shop.id'])).toBe(true)
  expect(args('deploy.addDomain', ['p1', 'x'.repeat(261)])).toBe(false)
  expect(args('deploy.createRecords', ['p1', ''])).toBe(false)
  expect(() => methods['deploy.project']!.run('other')).toThrow('not on this host')
  await methods['deploy.link']!.run('p1', 'vercel', 'r1')
  // The platform project is named after the Ramu project.
  expect(deploys.service.link).toHaveBeenCalledWith('p1', 'vercel', 'r1', 'my-shop')
})

it('reads a branch’s preview only for a repository of the thread’s own checkout', async () => {
  const { methods, deploys } = setup(false)
  expect(methods['deploy.preview']!.args.safeParse(['t1', 'r1', 'x'.repeat(201)]).success).toBe(false)
  expect(() => methods['deploy.preview']!.run('t1', 'r2', 'fix')).toThrow('no such repository')
  await methods['deploy.preview']!.run('t1', 'r1', 'fix')
  expect(deploys.preview).toHaveBeenCalledWith('r1', 'fix')
})
