import { describe, expect, it } from 'vitest'
import type { ComputerBackend } from '@ramu/shared/computerBridge'
import { ComputerService } from '../src/computer/service'
import { registerComputerHandlers } from '../src/ipc/handlers/computer'
import type { HandlerContext } from '../src/ipc/types'

function setup(deviceId: string | undefined, admin: boolean, text?: string) {
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
    host: { canAdministerIntegrations: () => admin, browserDevice: () => deviceId },
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
  it('requires the setting and the owning host before a grant', async () => {
    const owner = setup('local', true)
    await expect(owner.call('computer.grant', 't1', { observe: true, input: true })).rejects.toThrow(/Settings/)
    owner.call('computer.setEnabled', true)
    expect(await owner.call('computer.grant', 't1', { observe: true, input: true })).toMatchObject({
      target: { id: 'display:main' },
    })
    const remote = setup('phone', false)
    expect(() => remote.call('computer.setEnabled', true)).toThrow(/owning host/)
  })

  it('lets a paired device watch only after an explicit viewer grant, and drive only with input', async () => {
    const owner = setup('local', true)
    owner.call('computer.setEnabled', true)
    await owner.call('computer.grant', 't1', { observe: true, input: true })
    const phone = setup('phone', false)
    // The phone talks to the same service in a real host; share it here.
    Object.assign(phone, {})
    owner.computer.grantViewer('t1', 'phone', false)
    const viewerMethods = registerComputerHandlers({
      computer: owner.computer,
      host: { canAdministerIntegrations: () => false, browserDevice: () => 'phone' },
      workspace: { getTask: () => ({}), getAppState: (_: string, fallback: unknown) => fallback },
      agents: { list: () => [{ id: 'run1', state: 'running' }] },
    } as unknown as HandlerContext)
    const run = (name: string, ...args: unknown[]) =>
      viewerMethods[name]!.run(...(viewerMethods[name]!.args.parse(args) as unknown[]))
    expect(await run('computer.frame', 't1')).toMatchObject({ width: 100 })
    expect(() => run('computer.takeControl', 't1')).toThrow(/not granted/)
    owner.computer.grantViewer('t1', 'phone', true)
    expect(run('computer.takeControl', 't1')).toMatchObject({ controller: { kind: 'human', deviceId: 'phone' } })
    expect(run('computer.giveToAgent', 't1')).toMatchObject({ controller: { kind: 'agent', runId: 'run1' } })
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
