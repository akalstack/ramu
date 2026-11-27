import { expect, it } from 'vitest'
import { serversPollMs } from '../src/chat/serversPoll'

it('reads a thread’s servers every few seconds only while the window is in front', () => {
  expect(serversPollMs(true)).toBe(5000)
  expect(serversPollMs(false)).toBe(60_000)
})
