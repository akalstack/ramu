import { test } from 'node:test'
import assert from 'node:assert/strict'
import { keptPullRequests } from '../src/runtime/keptPullRequests.ts'

const memory = () => {
  const items = new Map()
  return { items, getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, value) }
}

test('a pull request read opens on what this phone last read for the same host and arguments', () => {
  const store = memory()
  const kept = keptPullRequests(store)
  const list = [{ repoId: 'r', pullRequests: [{ url: 'u' }] }]
  kept.keep('a', 'forge.allPullRequests', list, false, false)
  // Read back through a fresh instance, as after the app restarts.
  const later = keptPullRequests(store)
  assert.deepEqual(later.read('a', 'forge.allPullRequests', false, false), list)
  assert.equal(later.read('a', 'forge.allPullRequests', true, false), undefined, 'closed is kept apart from open')
})

test("one host's pull requests never show under another", () => {
  const kept = keptPullRequests(memory())
  kept.keep('a', 'forge.pullRequestDescription', 'From host A', 't', 'r', 'u')
  assert.equal(kept.read('b', 'forge.pullRequestDescription', 't', 'r', 'u'), undefined)
})
