import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// A settings page renders several host-scoped panels side by side (Agent setup shows its settings and its rules,
// Memory its reviews and its notes). Each is keyed so it remounts on a host change; two siblings keyed by the host id
// alone collide, which React reports and may answer by dropping one of them.
test('host-scoped settings panels have keys of their own', () => {
  const source = readFileSync(new URL('../src/app/settings/[section].tsx', import.meta.url), 'utf8')
  const keys = [...source.matchAll(/ key=\{(`[^`]*`|[^}]*)\}/g)].map((match) => match[1])
  assert.ok(keys.length > 5)
  assert.equal(new Set(keys).size, keys.length, `repeated keys: ${keys.filter((key, i) => keys.indexOf(key) !== i)}`)
})
