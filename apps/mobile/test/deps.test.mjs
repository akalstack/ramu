// Guards the hoisted-workspace setup: React Native needs the exact React its
// renderer was built for, while the desktop keeps the catalog version at the root.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const pkg = (name) => JSON.parse(readFileSync(require.resolve(`${name}/package.json`, { paths: [new URL('..', import.meta.url).pathname] }), 'utf8'))

test('mobile React matches the Expo SDK pin', () => {
  const bundled = require('expo/bundledNativeModules.json')
  assert.equal(pkg('react').version, bundled.react)
  assert.equal(pkg('react-dom').version, bundled['react-dom'])
  assert.equal(pkg('react-native').version, bundled['react-native'])
})

test('Metro resolves react from this app, not the workspace root', () => {
  const config = readFileSync(new URL('../metro.config.js', import.meta.url), 'utf8')
  assert.match(config, /pinned = new Set\(\['react', 'react-dom'\]\)/)
  assert.ok(require.resolve('react', { paths: [new URL('..', import.meta.url).pathname] }).includes('apps/mobile/node_modules/react'))
})
