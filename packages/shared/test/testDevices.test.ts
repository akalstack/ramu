import { expect, it } from 'vitest'
import {
  androidKeyCode,
  androidText,
  pngSize,
  testDeviceSummary,
  uiTreeText,
  type TestDeviceStatus,
} from '../src/testDevices'

it('reads PNG sizes without decoding and refuses anything else', () => {
  const header = new Uint8Array(24)
  header.set([0x89, 0x50, 0x4e, 0x47])
  new DataView(header.buffer).setUint32(16, 1206)
  new DataView(header.buffer).setUint32(20, 2622)
  expect(pngSize(header)).toEqual({ width: 1206, height: 2622 })
  expect(pngSize(new Uint8Array(10))).toBeNull()
})

it('types into an emulator as one shell word, never as shell syntax', () => {
  expect(androidText('hello world')).toBe('hello%sworld')
  expect(androidText('a;rm -rf $HOME')).toBe(String.raw`a\;rm%s-rf%s\$HOME`)
  expect(androidKeyCode('Enter')).toBe(66)
  expect(androidKeyCode('F13')).toBeNull()
})

it('turns a uiautomator dump into readable elements with their centres', () => {
  const xml =
    '<hierarchy><node class="android.widget.Button" text="Sign in" clickable="true" bounds="[0,100][200,200]" /><node class="android.view.View" text="" clickable="false" bounds="[0,0][1,1]"/></hierarchy>'
  expect(uiTreeText(xml)).toBe('Button "Sign in" (tap) @100,150')
})

const status = (patch: Partial<TestDeviceStatus> = {}): TestDeviceStatus => ({
  enabled: true,
  ios: { ready: true, missing: [] },
  android: { ready: true, missing: [] },
  devices: [],
  ...patch,
})

it('sums test devices up as one status line: off, ready with what is in use, or what still needs setup', () => {
  expect(testDeviceSummary(status({ enabled: false }))).toEqual({ state: 'off', parts: [{ text: 'Off' }] })
  expect(testDeviceSummary(status({ devices: [{ id: 'a', platform: 'ios', name: 'iPhone', running: true }] }))).toEqual(
    { state: 'ready', parts: [{ text: 'Ready on iOS and Android' }, { text: '{0} in use', values: { 0: 1 } }] },
  )
  const xcode = { ready: false, missing: [{ item: 'Xcode', fix: 'Install Xcode.' }] }
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
