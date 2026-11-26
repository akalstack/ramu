import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

// The toast store has no React Native in it, so it is compiled and loaded as it is.
const source = ts.transpileModule(readFileSync(new URL('../src/runtime/toast.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const load = () => {
  const module = { exports: {} }
  new Function('module', 'exports', source)(module, module.exports)
  return module.exports
}

test('an error that keeps coming back is shown once, while a different one still shows', () => {
  const toast = load()
  toast.showError('The host answered agent.changes in a shape this app does not know')
  const first = toast.currentToast().id
  toast.dismissToast()
  toast.showError('The host answered agent.changes in a shape this app does not know')
  assert.equal(toast.currentToast(), null)
  toast.showError('Could not reach the host')
  assert.notEqual(toast.currentToast().id, first)
  assert.equal(toast.currentToast().message, 'Could not reach the host')
})
