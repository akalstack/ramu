import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

const app = new URL('../src/app/', import.meta.url)
const has = (path) => existsSync(new URL(path, app))
const source = (path) => readFileSync(new URL(path, app), 'utf8')

test('every tab trigger has a folder with its own stack and a first screen', () => {
  const triggers = [...source('(tabs)/_layout.tsx').matchAll(/Trigger name="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(triggers, ['(threads)', 'inbox', 'pulls', 'artifacts', 'compose'])
  for (const name of triggers) {
    assert.ok(has(`(tabs)/${name}/_layout.tsx`), `${name} layout`)
    assert.ok(has(`(tabs)/${name}/index.tsx`), `${name} screen`)
  }
})

test('the root stack names only routes that exist', () => {
  const names = [...source('_layout.tsx').matchAll(/Stack\.Screen name="([^"]+)"/g)].map((m) => m[1])
  assert.ok(names.includes('(tabs)'))
  for (const name of names) {
    const found = has(`${name}.tsx`) || has(`${name}/index.tsx`) || has(`${name}/_layout.tsx`)
    assert.ok(found, `${name} has a route file`)
  }
})

test('Threads stays the root route, so "/" still means the home list', () => {
  assert.ok(has('(tabs)/(threads)/index.tsx'))
  assert.ok(!has('index.tsx'), 'no second root route')
})

test('the schedule editor and summary route are where their links point', () => {
  assert.ok(has('schedule-edit.tsx'))
  assert.ok(has('(tabs)/inbox/summary.tsx'))
  assert.ok(has('schedules/index.tsx'))
  assert.ok(has('schedules/[id].tsx'))
  assert.ok(has('pull-request.tsx'))
})

test('Search remains a root destination while New thread occupies the final tab', () => {
  assert.ok(has('search.tsx'))
  assert.ok(!has('(tabs)/search/index.tsx'))
  assert.match(source('(tabs)/_layout.tsx'), /Trigger name="compose" prominent/)
  assert.ok(!source('(tabs)/_layout.tsx').includes('role="search"'))
})

test('ramu://artifact links open the artifact screen', () => {
  assert.ok(has('artifact/[computer]/[id].tsx'))
  assert.ok(!has('page/[computer]/[id].tsx'))
})
