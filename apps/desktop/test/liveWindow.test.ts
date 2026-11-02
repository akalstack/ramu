import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }))

it('lets the live view window watch and stop, and nothing else', async () => {
  const { liveMethodAllowed } = await import('../src/main/liveWindow')
  for (const method of ['computer.frame', 'agent.stop', 'browser.preview', 'live.open'])
    expect(liveMethodAllowed(method)).toBe(true)
  for (const method of [
    'agent.submit',
    'computer.input',
    'browser.takeControl',
    'files.write',
    'live.window',
    'settings.app.set',
  ])
    expect(liveMethodAllowed(method)).toBe(false)
})
