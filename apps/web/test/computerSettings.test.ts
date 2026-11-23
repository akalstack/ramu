import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ index: 0, status: {} as Record<string, unknown>, invoke: vi.fn() }))
vi.mock('react', async () => ({
  ...(await vi.importActual<typeof import('react')>('react')),
  useState: (initial: unknown) => [state.index++ === 0 ? state.status : initial, vi.fn()],
  useEffect() {},
}))
vi.mock('../src/ipc', () => ({ invokeOn: state.invoke, ramu: { invoke: state.invoke } }))
vi.mock('../src/hosts', () => ({ ownHostId: () => 'local' }))
vi.mock('../src/settings/SettingsScope', async () => ({
  SettingsScopeContext: (await import('react')).createContext(null),
}))
vi.mock('../src/workspace/computers', () => ({ useComputers: () => null }))
vi.mock('../src/i18n', () => ({ useLanguage() {}, t: (text: string) => text }))
vi.mock('../src/components/ui/switch', () => ({
  Switch: (props: Record<string, unknown>) =>
    createElement('input', {
      type: 'checkbox',
      role: 'switch',
      'aria-label': props['aria-label'],
      checked: props.checked,
      disabled: props.disabled,
      readOnly: true,
    }),
}))
import { ComputerSettings } from '../src/settings/ComputerSettings'

beforeEach(() => {
  state.index = 0
  state.status = {
    enabled: false,
    runtime: { available: true, computer: { name: 'Mac' } },
    apps: null,
    appPermissions: null,
    keepAwake: false,
    globalPointer: false,
  }
})
it('shows computer access as an off switch and offers reset defaults', () => {
  const html = renderToStaticMarkup(createElement(ComputerSettings, { hostId: 'local' }))
  expect(html).toContain('role="switch" aria-label="Let agents use this computer"')
  expect(html).not.toContain('checked=""')
  expect(html).toContain('Reset defaults')
  expect(html).not.toContain('Turn on</button>')
})
it('uses a switch for pointer drags and an action button for a tested runtime update', () => {
  state.status = {
    ...state.status,
    enabled: true,
    apps: { available: true },
    appUpdate: { installedVersion: '1.0.0', supportedVersion: '1.1.2', updateAvailable: true, managed: true },
  }
  const html = renderToStaticMarkup(createElement(ComputerSettings, { hostId: 'local' }))
  expect(html).toContain('role="switch" aria-label="Let app drags use your real pointer"')
  expect(html).toContain('Update</button>')
  expect(html).toContain('Update to the tested version 1.1.2')
})

it.each([true, false])('offers permission setup while computer access is %s', (available) => {
  state.status = {
    ...state.status,
    apps: { available },
    appPermissions: { allGranted: false, accessibilityTrusted: false, screenCaptureGranted: false },
  }
  const html = renderToStaticMarkup(createElement(ComputerSettings, { hostId: 'local' }))
  expect(html).toContain(available ? 'Set up permissions</button>' : 'Install &amp; set up</button>')
})

it('shows a completed permission state without offering a setup action', () => {
  state.status = {
    ...state.status,
    apps: { available: true },
    appPermissions: { allGranted: true, accessibilityTrusted: true, screenCaptureGranted: true },
  }
  const html = renderToStaticMarkup(createElement(ComputerSettings, { hostId: 'local' }))
  expect(html).toContain('Permissions granted')
  expect(html).not.toContain('Set up permissions')
  expect(html).toContain('disabled=""')
  expect(html).toContain('App control')
})

it('retries an unreadable permission snapshot without offering onboarding', () => {
  state.status = { ...state.status, apps: { available: true }, appPermissions: null }
  const html = renderToStaticMarkup(createElement(ComputerSettings, { hostId: 'local' }))
  expect(html).toContain('Retry permission check</button>')
  expect(html).not.toContain('Set up permissions</button>')
})
