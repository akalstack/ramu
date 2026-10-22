import { test } from 'node:test'
import assert from 'node:assert/strict'
import { goBackOrHome } from '../src/runtime/navigation.ts'

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
