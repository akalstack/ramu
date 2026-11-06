import { describe, expect, it } from 'vitest'
import type { ComputerStatus } from '@ramu/shared/types'
import {
  activityChannel,
  isHostInvokeAllowed,
  isSettingsActionAllowed,
  routeInvoke,
  routeTaskCommand,
} from '../src/main/hostInvoke'

const hosts: Record<string, ComputerStatus> = {
  local: 'connected',
  studio: 'connected',
  laptop: 'offline',
  nas: 'paused',
  old: 'rejected',
  pending: 'connecting',
}
const routing = (self = 'local') => ({
  self,
  exists: (id: string) => id in hosts,
  status: (id: string) => hosts[id]!,
})

describe('routeInvoke', () => {
  it("keeps the window path when no host is named or the window's own host is", () => {
    expect(routeInvoke(undefined, 'tasks.list', routing())).toEqual({ host: 'local', direct: false })
    expect(routeInvoke(null, 'settings.app.set', routing('studio'))).toEqual({ host: 'studio', direct: false })
    // Naming the own host is the same as naming none, so main-handled methods still work for it.
    expect(routeInvoke('studio', 'background.restart', routing('studio'))).toEqual({ host: 'studio', direct: false })
  })

  it('sends an allow-listed method to the named host directly', () => {
    expect(routeInvoke('studio', 'tasks.pin', routing())).toEqual({ host: 'studio', direct: true })
    expect(routeInvoke('local', 'agent.list', routing('studio'))).toEqual({ host: 'local', direct: true })
  })

  it('rejects an unknown host and malformed host values', () => {
    expect(() => routeInvoke('ghost', 'tasks.list', routing())).toThrow('That host is no longer saved')
    expect(() => routeInvoke('', 'tasks.list', routing())).toThrow('Invalid host')
    expect(() => routeInvoke(7, 'tasks.list', routing())).toThrow('Invalid host')
  })

  it('rejects an offline, connecting, paused or rejected host before it looks at the method', () => {
    expect(() => routeInvoke('laptop', 'tasks.list', routing())).toThrow('not reachable')
    expect(() => routeInvoke('pending', 'tasks.list', routing())).toThrow('not reachable')
    expect(() => routeInvoke('nas', 'tasks.list', routing())).toThrow('paused')
    expect(() => routeInvoke('old', 'tasks.list', routing())).toThrow('Forget it')
  })

  it('refuses methods outside the allow-list on another host', () => {
    for (const method of [
      'background.restart',
      'app.relaunch',
      'updates.restart',
      'clipboard.write',
      'editor.menu',
      'computers.forget',
      'settings.permissions.clear',
      'providers.pickBinary',
      'repos.pick',
      'attachments.pick',
      'term.menu',
      'files.reveal',
      'tasks',
      'nonsense.method',
    ])
      expect(() => routeInvoke('studio', method, routing()), method).toThrow('not available on another host')
  })

  it('localises user-facing failures', () => {
    const text = (message: string) => `[${message}]`
    expect(() => routeInvoke('ghost', 'tasks.list', { ...routing(), text })).toThrow('[That host is no longer saved]')
  })
})

describe('isHostInvokeAllowed', () => {
  it('allows Shared MCP status while keeping administration on its execution host', () => {
    expect(isHostInvokeAllowed('mcp.status')).toBe(true)
    for (const method of [
      'mcp.save',
      'mcp.check',
      'mcp.account',
      'mcp.approve',
      'mcp.disconnect',
      'mcp.remove',
      'mcp.checkCredentialStore',
    ])
      expect(isHostInvokeAllowed(method)).toBe(false)
  })
  it('allows server-only domains and blocks native ones', () => {
    for (const method of [
      'tasks.list',
      'agent.submit',
      'git.status',
      'files.read',
      'term.write',
      'projects.list',
      // Import reads a share from another connected host.
      'artifacts.openShare',
    ])
      expect(isHostInvokeAllowed(method)).toBe(true)
    for (const method of [
      'repos.pick',
      'term.menu',
      'attachments.save',
      'background.stop',
      'computers.list',
      'pages.list',
    ])
      expect(isHostInvokeAllowed(method)).toBe(false)
    // Settings reads this device's role on each host; stopping or restarting that host's service stays there.
    expect(isHostInvokeAllowed('background.status')).toBe(true)
    expect(isHostInvokeAllowed('background.restart')).toBe(false)
    expect(isHostInvokeAllowed(42)).toBe(false)
  })
  it("keeps a host current from any device: its Ramu release and provider CLIs, but never this machine's restart", () => {
    for (const method of ['updates.status', 'updates.check', 'updates.apply', 'providers.updates', 'providers.update'])
      expect(isHostInvokeAllowed(method)).toBe(true)
    for (const method of ['updates.restart', 'updates.download']) expect(isHostInvokeAllowed(method)).toBe(false)
  })
})

describe('routeTaskCommand', () => {
  it('keeps the narrow thread command shape', () => {
    expect(routeTaskCommand('studio', 'tasks.pin', ['task', true], routing())).toEqual({
      host: 'studio',
      method: 'tasks.pin',
      args: ['task', true],
    })
    expect(() => routeTaskCommand('studio', 'tasks.pin', ['task', 'yes'], routing())).toThrow(
      'Invalid host thread action',
    )
    expect(() => routeTaskCommand('studio', 'agent.start', ['task'], routing())).toThrow('Invalid host thread action')
  })

  it('applies host checks even when the window belongs to the target host', () => {
    expect(routeTaskCommand('local', 'tasks.done', ['task', true], routing('local')).host).toBe('local')
    expect(() => routeTaskCommand('laptop', 'tasks.done', ['task', true], routing())).toThrow('not reachable')
    expect(() => routeTaskCommand('ghost', 'tasks.done', ['task', true], routing())).toThrow('no longer saved')
    expect(() => routeTaskCommand(undefined, 'tasks.done', ['task', true], routing())).toThrow('not connected')
  })
})

describe('push event host', () => {
  it('maps thread and project changes to the activity events that refresh overviews', () => {
    expect(activityChannel('tasks.rename')).toBe('workspace:changed')
    expect(activityChannel('projects.add')).toBe('workspace:changed')
    expect(activityChannel('recaps.act')).toBe('automation:changed')
    expect(activityChannel('git.status')).toBeNull()
  })
})

it('routes only the settings reads and writes required by a host workspace', () => {
  for (const method of ['settings.app.get', 'settings.app.set', 'settings.models.get', 'settings.models.set'])
    expect(isHostInvokeAllowed(method)).toBe(true)
  expect(isHostInvokeAllowed('settings.permissions.clear')).toBe(false)
})

describe('isSettingsActionAllowed', () => {
  it('lets Settings manage rules, skills and MCP on the chosen host', () => {
    for (const operation of [
      'rules.list',
      'rules.save',
      'rules.history',
      'rules.restore',
      'rules.remove',
      'skills.list',
      'mcp.status',
    ])
      expect(isSettingsActionAllowed(operation)).toBe(true)
  })
  it('lets Settings manage GitHub connections and computer use, and nothing else under forge or computer', () => {
    for (const operation of [
      'forge.connections',
      'forge.saveConnection',
      'forge.checkConnection',
      'forge.setConnectionEnabled',
      'forge.removeConnection',
      'forge.selectAccount',
      'computer.status',
      'computer.setEnabled',
    ])
      expect(isSettingsActionAllowed(operation)).toBe(true)
    for (const operation of ['forge.createPullRequest', 'computer.grant', 'computer.input'])
      expect(isSettingsActionAllowed(operation)).toBe(false)
  })
  it('keeps thread, file and unlisted project actions out', () => {
    for (const operation of ['agent.start', 'files.write', 'projects.remove', 'settings.permissions.add', 'rulesx', 42])
      expect(isSettingsActionAllowed(operation)).toBe(false)
  })
})
