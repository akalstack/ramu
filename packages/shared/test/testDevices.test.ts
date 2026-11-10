import { expect, it } from 'vitest'
import { pngSize, queuePlace, testDeviceFix, testDeviceSummary, type TestDeviceStatus } from '../src/testDevices'

it('reads PNG sizes without decoding and refuses anything else', () => {
  const header = new Uint8Array(24)
  header.set([0x89, 0x50, 0x4e, 0x47])
  new DataView(header.buffer).setUint32(16, 1206)
  new DataView(header.buffer).setUint32(20, 2622)
  expect(pngSize(header)).toEqual({ width: 1206, height: 2622 })
  expect(pngSize(new Uint8Array(10))).toBeNull()
})

const status = (patch: Partial<TestDeviceStatus> = {}): TestDeviceStatus => ({
  enabled: true,
  installed: true,
  setupCommand: 'npm install',
  ios: { ready: true, missing: [] },
  android: { ready: true, missing: [] },
  inUse: [],
  waiting: [],
  models: { ios: [], android: [] },
  defaults: { ios: null, android: null },
  keepWarm: false,
  maxRunning: null,
  slim: false,
  ...patch,
})

it('sums test devices up as one status line: off, not set up, ready with what is in use and waiting, or what is missing', () => {
  expect(testDeviceSummary(status({ enabled: false }))).toEqual({ state: 'off', parts: [{ text: 'Off' }] })
  expect(testDeviceSummary(status({ installed: false }))).toEqual({ state: 'setup', parts: [{ text: 'Needs setup' }] })
  expect(
    testDeviceSummary(
      status({
        inUse: [{ taskId: 'a', platform: 'ios', name: 'iPhone 17 · iOS 27.0', since: 0 }],
        waiting: [{ taskId: 'b', platform: 'ios', position: 1 }],
      }),
    ),
  ).toEqual({
    state: 'ready',
    parts: [
      { text: 'Ready on iOS and Android' },
      { text: '{0} in use', values: { 0: 1 } },
      { text: '{0} waiting', values: { 0: 1 } },
    ],
  })
  const xcode = { ready: false, missing: [{ item: 'xcode', name: 'Xcode', fix: 'Install Xcode.' }] }
  expect(testDeviceSummary(status({ ios: xcode }))).toEqual({
    state: 'setup',
    parts: [{ text: 'Ready on Android' }, { text: 'Needs setup: {0}', values: { 0: 'Xcode' } }],
  })
})

it('does not count a platform this host cannot run as something to set up', () => {
  const linux = status({ ios: { ready: false, unsupported: 'iOS Simulators run only on a Mac.', missing: [] } })
  expect(testDeviceSummary(linux)).toEqual({ state: 'ready', parts: [{ text: 'Ready on Android' }] })
  const nothing = status({ ...linux, android: { ready: false, unsupported: 'No.', missing: [] } })
  expect(testDeviceSummary(nothing).parts).toEqual([{ text: 'Not available on this host' }])
})

it('says where a waiting thread stands, or that its device is being made', () => {
  expect(queuePlace(2)).toEqual({ text: 'Waiting for a device · number {0} in line', values: { 0: 2 } })
  expect(queuePlace(null)).toEqual({ text: 'Getting a device ready' })
})

it('offers a page to install from, or the administrator command to copy, for what Simlock finds missing', () => {
  expect(testDeviceFix('xcode')).toMatchObject({ kind: 'link', label: 'Get Xcode' })
  expect(testDeviceFix('xcode-license')).toEqual({
    kind: 'command',
    label: 'Copy command',
    command: 'sudo xcodebuild -license accept',
  })
  expect(testDeviceFix('android-emulator')).toMatchObject({ kind: 'link', url: 'https://developer.android.com/studio' })
  expect(testDeviceFix('ios-runtime')).toEqual({
    kind: 'command',
    label: 'Copy command',
    command: 'xcodebuild -downloadPlatform iOS',
  })
  expect(testDeviceFix('something-new')).toBeNull()
})
