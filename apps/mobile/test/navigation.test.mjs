import { test } from 'node:test'
import assert from 'node:assert/strict'
import { arrivalAnimation, backHistory, goBackOrHome } from '../src/runtime/navigation.ts'

test('back returns to the previous screen when navigation history exists', () => {
  const actions = []
  goBackOrHome({ canGoBack: () => true, back: () => actions.push('back'), replace: (path) => actions.push(path) })
  assert.deepEqual(actions, ['back'])
})
test('a direct link or dismissed stack returns home without an unhandled GO_BACK', () => {
  const actions = []
  let history = true
  const router = {
    canGoBack: () => history,
    back: () => {
      actions.push('back')
      history = false
    },
    replace: (path) => actions.push(path),
  }
  goBackOrHome(router)
  goBackOrHome(router)
  assert.deepEqual(actions, ['back', '/'])
})

test('the back menu lists earlier screens nearest first, with how far back each one is', () => {
  const titles = new Map([
    ['threads', 'Threads'],
    ['chat', 'Fix login'],
    ['explorer', 'Files'],
  ])
  const state = {
    index: 3,
    routes: [
      { key: 'tabs', state: { index: 0, routes: [{ key: 'threads-stack', state: { routes: [{ key: 'threads' }] } }] } },
      { key: 'chat' },
      { key: 'untitled' },
      { key: 'explorer' },
    ],
  }
  assert.deepEqual(backHistory(state, titles), [
    { label: 'Fix login', count: 2 },
    { label: 'Threads', count: 3 },
  ])
})
test('the first screen of a stack has no back menu', () => {
  assert.deepEqual(backHistory({ routes: [{ key: 'only' }] }, new Map([['only', 'Only']])), [])
})

test('a thread started from New thread opens in its place, while every other way into a thread keeps the transition', () => {
  assert.equal(arrivalAnimation('rise'), 'none')
  assert.equal(arrivalAnimation('shown'), 'none')
  assert.equal(arrivalAnimation(undefined), 'default')
  // A link with an unknown value is an ordinary visit.
  assert.equal(arrivalAnimation('later'), 'default')
})
