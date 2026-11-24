import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)

test('the phone carries the Ramu release it was built from, apart from the store version', () => {
  const release = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')).version
  const config = require('../app.config.js')({ config: { version: '0.1.1', extra: { kept: true }, android: {} } })
  assert.equal(config.extra.releaseVersion, release)
  assert.equal(config.extra.kept, true)
  assert.equal(config.version, '0.1.1')
})
