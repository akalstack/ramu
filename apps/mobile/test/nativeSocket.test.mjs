import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('native connections suppress synthesized browser origins and retain device authentication', () => {
  let request
  const module = { exports: {} }
  const code = ts.transpileModule(readFileSync(new URL('../src/runtime/socketTransport.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(code, {
    module,
    exports: module.exports,
    require(name) {
      if (name === '@ramu/client-runtime/socket') return { RuntimeSocket: class {} }
      if (name === './hostSubscription') return {}
      if (name === './transport') return { registerSocketProvider() {} }
      if (name === './link') return { linkAware: (factory) => factory }
      throw new Error(name)
    },
    WebSocket: class {
      constructor(url, protocols, options) {
        request = { url, protocols, headers: options.headers }
        this.close = () => {}
        this.send = () => {}
      }
    },
  })
  const events = []
  const connection = module.exports.nativeSocketFactory(
    'ws://100.99.224.30:7788/socket',
    { Authorization: 'Bearer device' },
    {
      onopen() {
        events.push('open')
      },
      onmessage() {},
      onclose() {},
    },
  )
  assert.equal(request.headers.Authorization, 'Bearer device')
  assert.equal(request.headers.origin, '')
  assert.equal(request.url, 'ws://100.99.224.30:7788/socket')
  connection.close()
})
