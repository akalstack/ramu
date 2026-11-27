import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = ts.transpileModule(readFileSync(new URL('../src/runtime/paste.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText

/** Loads the paste hook against a stand-in native module, running each effect as it is declared. */
function load(os, native) {
  const cleanups = []
  const react = {
    useRef: (current) => ({ current }),
    useEffect(effect) {
      const cleanup = effect()
      if (cleanup) cleanups.push(cleanup)
    },
  }
  const module = { exports: {} }
  runInNewContext(source, {
    exports: module.exports,
    require: (id) =>
      id === 'react'
        ? react
        : id === 'react-native'
          ? { Platform: { OS: os }, findNodeHandle: () => 42 }
          : { requireOptionalNativeModule: () => native },
  })
  return { ...module.exports, unmount: () => cleanups.splice(0).forEach((run) => run()) }
}

function nativePaste() {
  const listeners = new Set()
  const watched = []
  return {
    watched,
    watch: async (tag) => watched.push(tag),
    addListener: (_event, listener) => {
      listeners.add(listener)
      return { remove: () => listeners.delete(listener) }
    },
    paste: (event) => listeners.forEach((listener) => listener(event)),
    listeners,
  }
}

const picture = {
  uri: 'file:///tmp/ramu-paste-1/pasted-1.jpg',
  name: 'pasted-1.jpg',
  mimeType: 'image/jpeg',
  size: 2048,
}

test('a picture pasted into the focused message box is attached, and nothing reaches a field that is not being edited', () => {
  const native = nativePaste()
  const paste = load('ios', native)
  let focused = true
  const received = []
  paste.usePastedFiles({ current: { isFocused: () => focused } }, (files) => received.push(files))
  native.paste({ files: [picture] })
  assert.deepEqual(received, [[picture]])
  focused = false
  native.paste({ files: [picture] })
  assert.equal(received.length, 1)
  paste.unmount()
  assert.equal(native.listeners.size, 0, 'leaving the composer stops listening')
})

test('Android watches the message box itself; iOS needs no watch', () => {
  const android = nativePaste()
  load('android', android).usePastedFiles({ current: { isFocused: () => true } }, () => {})
  assert.deepEqual(android.watched, [42])
  const ios = nativePaste()
  load('ios', ios).usePastedFiles({ current: { isFocused: () => true } }, () => {})
  assert.deepEqual(ios.watched, [])
})

test('only well-formed items cross the native boundary, ten at most, and an item over the limit keeps its name', () => {
  const { pastedFiles } = load('ios', null)
  const tooBig = { uri: '', name: 'video.mov', mimeType: 'video/quicktime', size: 40_000_000 }
  assert.deepEqual(pastedFiles({ files: [picture, tooBig, { uri: 1 }, null, { ...picture, name: '' }] }), [
    picture,
    tooBig,
  ])
  assert.equal(pastedFiles({ files: Array.from({ length: 12 }, () => picture) }).length, 10)
  assert.equal(pastedFiles(undefined).length, 0)
})

test('a build without the native module leaves the message box as it was', () => {
  const { usePastedFiles } = load('ios', null)
  assert.doesNotThrow(() => usePastedFiles({ current: null }, () => assert.fail('nothing is pasted')))
})
