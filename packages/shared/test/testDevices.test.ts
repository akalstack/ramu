import { expect, it } from 'vitest'
import { androidKeyCode, androidText, pngSize, uiTreeText } from '../src/testDevices'

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
