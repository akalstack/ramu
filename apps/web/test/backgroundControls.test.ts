import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  index: 0,
  status: null as Record<string, unknown> | null,
  connected: true,
  restarting: new Set<string>(),
}))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  // BackgroundControls holds the service status, then whether it is connected.
  useState: (initial: unknown) => {
    const index = state.index++
    return [index === 0 ? state.status : index === 1 ? state.connected : initial, vi.fn()]
  },
  useEffect() {},
}))
vi.mock('../src/ipc', () => ({
  bridge: { on: () => () => {} },
  ramu: { invoke: vi.fn(), on: () => () => {} },
  invoke: vi.fn(),
  invokeOn: vi.fn(),
}))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local', LOCAL_HOST: 'local' }))
vi.mock('../src/settings/AppSettings', () => ({ useAppSettings: () => ({ reload: vi.fn() }) }))
vi.mock('../src/settings/SettingsScope', () => ({
  useSettingsInvoke: () => vi.fn(),
  useSettingsEvents: () => () => () => {},
}))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/workspace/restartingHosts', () => ({ useRestartingHosts: () => state.restarting }))
// The schedules page around these controls is not under test.
vi.mock('../src/workspace/workspace', () => ({}))
vi.mock('../src/pages/PageSchedules', () => ({}))
vi.mock('../src/chat/AgentControls', () => ({}))
vi.mock('../src/models/ModelSets', () => ({}))
vi.mock('../src/WebhookSchedule', () => ({}))
vi.mock('../src/chat/Notifications', () => ({ notifyError: vi.fn() }))
vi.mock('../src/settings/TerminalCommand', () => ({ useTerminalCommand: () => ({ status: null }) }))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
import { BackgroundControls } from '../src/Automation'

const render = (compact = false) => {
  state.index = 0
  return renderToStaticMarkup(createElement(BackgroundControls, { compact }))
}
beforeEach(() => {
  state.status = { running: true, pid: 42, keepRunning: true, loginSupported: false }
  state.connected = true
  state.restarting = new Set()
})

it('offers Restart, not Stop, for this computer’s running service', () => {
  const html = render()
  expect(html).toContain('Running · PID {0}')
  expect(html).toContain('Restart service</button>')
  expect(html).not.toContain('Stop</button>')
})

it('reads a restart in progress as restarting, without offering Start', () => {
  state.connected = false
  state.restarting = new Set(['local'])
  const html = render()
  expect(html).toContain('Restarting…')
  expect(html).not.toContain('Stopped')
  expect(html).not.toContain('Start</button>')
  const compact = render(true)
  expect(compact).toContain('Restarting…')
  expect(compact).not.toContain('Background service stopped')
})

it('offers Start for a stopped service, and no restart for another host’s', () => {
  state.connected = false
  expect(render()).toContain('Start</button>')
  expect(render(true)).toContain('Background service stopped')
  state.connected = true
  state.status = { running: true, pid: 7 }
  expect(render()).not.toContain('</button>')
})
