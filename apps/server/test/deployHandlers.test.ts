import { expect, it, vi } from 'vitest'
import { registerDeployHandlers } from '../src/ipc/handlers/deploy'
import { KeyedLock } from '../src/ipc/keyedLock'

const setup = (local: boolean) => {
  const deploys = {
    accounts: { save: vi.fn(async () => ({})), disconnect: vi.fn(), list: vi.fn(async () => []) },
    signIns: { start: vi.fn(() => ({})) },
    service: { link: vi.fn(async () => ({})), deploy: vi.fn(async () => ({})), project: vi.fn(async () => ({})) },
  }
  const methods = registerDeployHandlers({
    host: { canAdministerIntegrations: () => local },
    lock: new KeyedLock(),
    deploys,
    workspace: { listProjects: () => [{ id: 'p1', name: 'My Shop!' }] },
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
