import { describe, expect, it, vi } from 'vitest'
import type { ComputerBackend } from '@ramu/shared/computerBridge'
import { ComputerService } from '../src/computer/service'
import { registerComputerHandlers } from '../src/ipc/handlers/computer'
import type { HandlerContext } from '../src/ipc/types'

const ocu = vi.hoisted(() => ({ install: vi.fn(async () => '1.1.2'), setup: vi.fn(async () => {}) }))
vi.mock('../src/computer/ocu', () => ({
  installOcu: ocu.install,
  setupOcu: ocu.setup,
  ocuPermissions: async () => null,
  ocuUpdateStatus: () => ({ installedVersion: null, supportedVersion: '1.1.2', updateAvailable: false, managed: true }),
}))

vi.mock('../src/computer/lockedUse', () => ({
  LockedUse: class {
    async status() {
      return { enabled: false }
    }
    async disable() {
      return { enabled: false }
    }
  },
}))

function setup(deviceId: string | undefined, admin: boolean, text?: string, eligible = () => false) {
  const backend: ComputerBackend = {
    status: () => ({ available: true, computer: { id: 'local', name: 'Mac' } }),
    capture: async () => ({
      mimeType: 'image/png',
      data: 'AAAA',
      width: 100,
      height: 100,
      scale: 1,
      ...(text ? { text } : {}),
    }),
    perform: async () => {},
    releaseInput: () => {},
  }
  const state = new Map<string, unknown>()
  const computer = new ComputerService(backend)
  const methods = registerComputerHandlers({
    computer,
    host: { canAdministerIntegrations: () => admin, browserDevice: () => deviceId, browserGrantEligible: eligible },
    workspace: {
      getTask: () => ({}),
      listTasks: () => [{ id: 't1' }],
      getAppState: (key: string, fallback: unknown) => (state.has(key) ? state.get(key) : fallback),
      setAppState: (key: string, value: unknown) => state.set(key, value),
    },
    agents: { list: () => [{ id: 'run1', state: 'running' }] },
    awake: { status: () => ({ active: true }) },
  } as unknown as HandlerContext)
  const call = (name: string, ...args: unknown[]) =>
    methods[name]!.run(...(methods[name]!.args.parse(args) as unknown[]))
  return { call, computer }
}

describe('computer handlers', () => {
  it('lets a paired owner device read Locked Use but change it only on the host', async () => {
    const paired = setup('laptop', false, undefined, () => true)
    expect(await paired.call('computer.lockedUse')).toEqual({ enabled: false })
    expect(() => paired.call('computer.lockedUseDisable')).toThrow(/owning host/)
    expect(() => setup('phone', false).call('computer.lockedUse')).toThrow(/owner device/)
  })
  it('requires the setting and the owning host before a grant', async () => {
    const owner = setup('local', true)
    await expect(owner.call('computer.grant', 't1', { observe: true, input: true })).rejects.toThrow(/Settings/)
    owner.call('computer.setEnabled', true)
    expect(await owner.call('computer.grant', 't1', { observe: true, input: true })).toMatchObject({
      target: { id: 'display:main' },
    })
    const remote = setup('phone', false)
    expect(() => remote.call('computer.setEnabled', true)).toThrow(/owner device/)
  })

  it('resets access and pointer defaults and revokes active sessions', async () => {
    const owner = setup('local', true)
    owner.call('computer.setEnabled', true)
    owner.call('computer.setGlobalPointer', true)
    await owner.call('computer.grant', 't1', { observe: true, input: true })
    await owner.call('computer.resetDefaults')
    expect(await owner.call('computer.status')).toMatchObject({ enabled: false, globalPointer: false })
    expect(owner.computer.session('t1')).toBeUndefined()
    const remote = setup('phone', false)
    await expect(remote.call('computer.resetDefaults')).rejects.toThrow(/owning host/)
  })

  it('refuses to install over an active computer session', async () => {
    const owner = setup('local', true)
    owner.call('computer.setEnabled', true)
    await owner.call('computer.grant', 't1', { observe: true, input: true })
    await expect(owner.call('computer.installApps')).rejects.toThrow(/Stop computer use/)
  })

  it('lets a paired owner phone share a target, view it, take control, and stop without a second device grant', async () => {
    let paired = true
    const phone = setup('phone', false, undefined, () => paired)
    phone.call('computer.setEnabled', true)
    await phone.call('computer.grant', 't1', { observe: true, input: true })
    expect(await phone.call('computer.frame', 't1')).toMatchObject({ width: 100 })
    expect(phone.call('computer.takeControl', 't1')).toMatchObject({ controller: { kind: 'human', deviceId: 'phone' } })
    paired = false
    await expect(phone.call('computer.frame', 't1')).rejects.toThrow(/not granted/)
    paired = true
    phone.call('computer.revoke', 't1')
    expect(phone.computer.session('t1')).toBeUndefined()
    await expect(phone.call('computer.installApps')).rejects.toThrow(/owning host/)
  })

  it('lets a paired owner device watch and drive a thread’s computer, and refuses any other device', async () => {
    const owner = setup('local', true)
    owner.call('computer.setEnabled', true)
    await owner.call('computer.grant', 't1', { observe: true, input: true })
    const methods = (eligible: boolean) =>
      registerComputerHandlers({
        computer: owner.computer,
        host: {
          canAdministerIntegrations: () => false,
          browserDevice: () => 'phone',
          browserGrantEligible: () => eligible,
        },
        workspace: { getTask: () => ({}), getAppState: (_: string, fallback: unknown) => fallback },
        agents: { list: () => [{ id: 'run1', state: 'running' }] },
      } as unknown as HandlerContext)
    const call = (eligible: boolean, name: string, ...args: unknown[]) => {
      const handlers = methods(eligible)
      return handlers[name]!.run(...(handlers[name]!.args.parse(args) as unknown[]))
    }
    expect(await call(true, 'computer.frame', 't1')).toMatchObject({ width: 100 })
    expect(call(true, 'computer.takeControl', 't1')).toMatchObject({ controller: { kind: 'human', deviceId: 'phone' } })
    expect(call(true, 'computer.giveToAgent', 't1')).toMatchObject({ controller: { kind: 'agent', runId: 'run1' } })
    await expect(call(false, 'computer.frame', 't1')).rejects.toThrow(/not granted/)
  })

  it('never sends the agent-only accessibility text to a viewer frame', async () => {
    const owner = setup('local', true, 'SECRET-TREE 1 button Pay')
    owner.call('computer.setEnabled', true)
    await owner.call('computer.grant', 't1', { observe: true, input: false })
    const frame = await owner.call('computer.frame', 't1')
    expect(frame).toMatchObject({ width: 100, mimeType: 'image/png' })
    expect(JSON.stringify(frame)).not.toContain('SECRET-TREE')
    expect(frame).not.toHaveProperty('text')
  })

  it('turns every thread’s access off when computer use is turned off', async () => {
    const owner = setup('local', true)
    owner.call('computer.setEnabled', true)
    await owner.call('computer.grant', 't1', { observe: true, input: false })
    owner.call('computer.setEnabled', false)
    expect(owner.computer.session('t1')).toBeUndefined()
  })
})

it('opens permission setup after installation and can reopen it without reinstalling', async () => {
  ocu.install.mockClear()
  ocu.setup.mockClear()
  const owner = setup('local', true)
  await expect(owner.call('computer.installApps')).resolves.toEqual({ version: '1.1.2' })
  expect(ocu.install).toHaveBeenCalledOnce()
  expect(ocu.setup).toHaveBeenCalledOnce()
  expect(ocu.install.mock.invocationCallOrder[0]).toBeLessThan(ocu.setup.mock.invocationCallOrder[0]!)
  await owner.call('computer.openSetup')
  expect(ocu.install).toHaveBeenCalledOnce()
  expect(ocu.setup).toHaveBeenCalledTimes(2)
  const phone = setup('phone', false)
  await expect(phone.call('computer.openSetup')).rejects.toThrow(/owning host/)
  expect(ocu.setup).toHaveBeenCalledTimes(2)
})

it('lists computer access only for an owner and removes only the revoked thread', async () => {
  const owner = setup('local', true)
  owner.call('computer.setEnabled', true)
  await owner.call('computer.grant', 't1', { observe: true, input: true })
  await owner.call('computer.grant', 't2', { observe: true, input: true })
  expect(owner.call('computer.sessions')).toEqual(
    expect.arrayContaining([expect.objectContaining({ threadId: 't1' }), expect.objectContaining({ threadId: 't2' })]),
  )
  owner.call('computer.revoke', 't1')
  expect(owner.call('computer.sessions')).toEqual([expect.objectContaining({ threadId: 't2' })])
  expect(() => setup('viewer', false).call('computer.sessions')).toThrow(/Pair an owner/)
  expect(setup('phone', false, undefined, () => true).call('computer.sessions')).toEqual([])
})
