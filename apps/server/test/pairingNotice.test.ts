import { expect, it } from 'vitest'
import { createPairingNotice } from '../src/remote/pairingNotice'

const request = (id: string) => ({ id, name: 'Phone', address: '10.0.0.2', code: '123456', expiresAt: 1 })

it('opens a closed desktop app once per request, prints each one for a headless host, and always pushes the list', () => {
  const pushed: number[] = []
  const opened: string[] = []
  const lines: string[] = []
  let connected = false
  const notice = createPairingNotice({
    push: (requests) => pushed.push(requests.length),
    desktopConnected: () => connected,
    desktopApp: '/Applications/Ramu.app/Contents/MacOS/Ramu',
    log: (line) => lines.push(line),
    open: (executable) => opened.push(executable),
  })
  notice([request('a')])
  notice([request('a')])
  expect(opened).toHaveLength(1)
  expect(lines).toHaveLength(1)
  expect(lines[0]).toContain('ramu pair --approve a')
  expect(lines[0]).toContain('123456')
  // With the app open it shows the request itself; nothing is launched.
  connected = true
  notice([request('a'), request('b')])
  expect(opened).toHaveLength(1)
  notice([])
  expect(pushed).toEqual([1, 1, 2, 0])
})

it('never opens anything for a service that did not ship inside the desktop app', () => {
  const opened: string[] = []
  const notice = createPairingNotice({
    push: () => {},
    desktopConnected: () => false,
    log: () => {},
    open: (executable) => opened.push(executable),
  })
  notice([request('a')])
  expect(opened).toEqual([])
})
