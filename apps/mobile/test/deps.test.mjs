// Guards the hoisted-workspace setup: React Native needs the exact React its
// renderer was built for, even when it shares the desktop catalog version.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const pkg = (name) =>
  JSON.parse(
    readFileSync(require.resolve(`${name}/package.json`, { paths: [new URL('..', import.meta.url).pathname] }), 'utf8'),
  )

test('mobile React matches the Expo SDK pin', () => {
  const bundled = require('expo/bundledNativeModules.json')
  assert.equal(pkg('react').version, bundled.react)
  assert.equal(pkg('react-dom').version, bundled['react-dom'])
  assert.equal(pkg('react-native').version, bundled['react-native'])
})

test('Metro pins React resolution to the mobile dependency graph', () => {
  const config = readFileSync(new URL('../metro.config.js', import.meta.url), 'utf8')
  assert.match(config, /pinned = new Set\(\['react', 'react-dom'\]\)/)
  const mobileRequire = createRequire(new URL('../node_modules/index.js', import.meta.url))
  assert.equal(
    JSON.parse(readFileSync(mobileRequire.resolve('react/package.json'), 'utf8')).version,
    require('expo/bundledNativeModules.json').react,
  )
})

// Router resolves these optional native peers even though app code uses RN Animated.
// Pin them explicitly so pnpm cannot hoist incompatible versions into native builds.
test('router native peers are explicitly pinned to the installed Expo SDK', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const bundled = require('expo/bundledNativeModules.json')
  for (const name of ['react-native-reanimated', 'react-native-worklets', 'react-native-gesture-handler']) {
    assert.equal(manifest.dependencies[name], bundled[name], `${name} must pin the SDK-compatible native range`)
  }
})
