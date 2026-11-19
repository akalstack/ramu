import { test } from 'node:test'
import assert from 'node:assert/strict'
import { routingChoiceLabels } from '../src/runtime/routingChoices.ts'

const labels = (projects) => Object.fromEntries([...routingChoiceLabels(projects)].map(([id, v]) => [id, v]))

test('distinct names keep their plain name', () => {
  assert.deepEqual(
    labels([
      { id: 'a', name: 'Ramu', host: 'Laptop', root: '/src/ramu' },
      { id: 'b', name: 'Billing', host: 'Laptop', root: '/src/billing' },
    ]),
    { a: { label: 'Ramu', showsRoot: false }, b: { label: 'Billing', showsRoot: false } },
  )
})

test('the same name on two hosts names the host', () => {
  assert.deepEqual(
    labels([
      { id: 'a', name: 'Ramu', host: 'Laptop', root: '/src/ramu' },
      { id: 'b', name: 'Ramu', host: 'Server', root: '/srv/ramu' },
    ]),
    { a: { label: 'Ramu · Laptop', showsRoot: false }, b: { label: 'Ramu · Server', showsRoot: false } },
  )
})

test('the same name on one host names the folder, comparing names as Auto does (case and accents ignored)', () => {
  assert.deepEqual(
    labels([
      { id: 'a', name: 'Ramu', host: 'Laptop', root: '/src/ramu' },
      { id: 'b', name: 'ramú', host: 'Laptop', root: '/work/ramu' },
      { id: 'c', name: 'Ramu Mobile', host: 'Laptop', root: '/src/mobile' },
    ]),
    {
      a: { label: 'Ramu · /src/ramu', showsRoot: true },
      b: { label: 'ramú · /work/ramu', showsRoot: true },
      c: { label: 'Ramu Mobile', showsRoot: false },
    },
  )
})

test('a legacy project without a folder keeps its name, and another host is still named', () => {
  assert.deepEqual(
    labels([
      { id: 'a', name: 'Ramu', host: 'Laptop', root: null },
      { id: 'b', name: 'Ramu', host: 'Laptop', root: '/src/ramu' },
      { id: 'c', name: 'Ramu', host: 'Server', root: '/srv/ramu' },
    ]),
    {
      a: { label: 'Ramu · Laptop', showsRoot: false },
      b: { label: 'Ramu · Laptop · /src/ramu', showsRoot: true },
      c: { label: 'Ramu · Server', showsRoot: false },
    },
  )
})
