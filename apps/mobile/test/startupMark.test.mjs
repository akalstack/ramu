import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { LAUNCH_IMAGE_WIDTH, MARK_WAKE } from '../../../packages/shared/src/brandMark.ts'

test('the startup mark takes over from the launch image at the same size', () => {
  const config = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'))
  const splash = config.expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-splash-screen')
  assert.equal(splash[1].imageWidth, LAUNCH_IMAGE_WIDTH)
})

test('the wake starts and ends at rest, so it hands over to the still mark without a jump', () => {
  for (const frames of [MARK_WAKE.stem, MARK_WAKE.dot]) {
    assert.equal(frames[0].at, 0)
    assert.equal(frames.at(-1).at, 1)
  }
  assert.deepEqual(MARK_WAKE.dot.at(-1), { at: 1, x: 0, y: 0, scaleX: 1, scaleY: 1 })
  assert.equal(MARK_WAKE.stem.at(-1).rotate, 0)
})
