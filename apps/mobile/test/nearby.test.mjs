import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as contract from '@ramu/shared/discovery/contract'
import * as model from '../src/runtime/nearbyModel.ts'
const compile = (source) =>
  ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
    .outputText
const shared = { exports: {} }
runInNewContext(
  compile(readFileSync(new URL('../../../packages/shared/src/discovery/tracker.ts', import.meta.url), 'utf8')),
  { exports: shared.exports, require: () => contract },
)
const hostId = 'a'.repeat(32)
const host = {
  key: 'paired:mac:http',
  hostId,
  name: 'Work Mac',
  label: 'Work Mac',
  scheme: 'http',
  routes: [{ url: 'http://100.99.224.30:7788', interfaceName: null }],
  pairedHostId: 'mac',
}
const flush = () => new Promise((resolve) => setImmediate(resolve))
function native() {
  const listeners = new Map()
  return {
    start: async () => {},
    stop: async () => {},
    addListener: (event, callback) => {
      listeners.set(event, callback)
      return { remove: () => listeners.delete(event) }
    },
    emit: (event, value) => listeners.get(event)?.(value),
    listeners,
  }
}
function harness(module, probe) {
  const slots = [],
    pending = [],
    timers = new Map()
  let cursor = 0,
    counter = 0
  const react = {
    useState(initial) {
      const i = cursor++
      if (!(i in slots)) slots[i] = initial
      return [
        slots[i],
        (next) => {
          slots[i] = typeof next === 'function' ? next(slots[i]) : next
        },
      ]
    },
    useRef(initial) {
      const i = cursor++
      return (slots[i] ??= { current: initial })
    },
    useCallback: (callback) => callback,
    useEffect(callback, deps) {
      const i = cursor++,
        previous = slots[i]
      if (!previous || deps.some((dep, n) => dep !== previous.deps[n])) {
        previous?.cleanup?.()
        const effect = { deps }
        slots[i] = effect
        pending.push(() => {
          effect.cleanup = callback()
        })
      }
    },
  }
  const source = { exports: {} }
  const timer = (fn, ms) => {
    const id = ++counter
    timers.set(id, { fn, ms })
    return id
  }
  runInNewContext(compile(readFileSync(new URL('../src/runtime/nearby.ts', import.meta.url), 'utf8')), {
    exports: source.exports,
    AbortController,
    setInterval: timer,
    setTimeout: timer,
    clearInterval: (id) => timers.delete(id),
    clearTimeout: (id) => timers.delete(id),
    require: (id) =>
      ({
        react,
        'react-native': { Platform: { OS: 'ios' } },
        expo: { requireOptionalNativeModule: () => module },
        '@ramu/shared/discovery/contract': contract,
        '@ramu/shared/discovery/tracker': shared.exports,
        './nearbyModel': model,
      })[id],
  })
  return {
    render(active = true) {
      cursor = 0
      const result = source.exports.useNearbyHosts(active, () => null, probe)
      pending.splice(0).forEach((effect) => effect())
      return result
    },
    refresh() {
      for (const timer of [...timers.values()]) if (timer.ms === 10000) timer.fn()
    },
    timers,
  }
}

test('direct discovery lists a paired VPN host when the build has no native browse module', async () => {
  const h = harness(null, async (_signal, found) => found(host))
  h.render()
  await flush()
  const state = h.render().state
  assert.equal(state.hosts.length, 1)
  assert.equal(state.hosts[0].pairedHostId, 'mac')
  assert.notEqual(state.status, 'unavailable')
  h.render(false)
  assert.equal(h.timers.size, 0)
})

test('denying local-network browsing does not erase directly verified VPN results', async () => {
  const n = native(),
    h = harness(n, async (_signal, found) => found(host))
  h.render()
  await flush()
  n.emit('onError', { code: 'permission' })
  const state = h.render().state
  assert.equal(state.status, 'denied')
  assert.equal(state.hosts[0].pairedHostId, 'mac')
  h.render(false)
  assert.equal(n.listeners.size, 0)
})

test('closing the screen aborts direct discovery and ignores late results', async () => {
  let signal, found, finish
  const h = harness(null, (s, f) => {
    signal = s
    found = f
    return new Promise((resolve) => {
      finish = resolve
    })
  })
  h.render()
  await flush()
  h.render(false)
  assert.equal(signal.aborted, true)
  found(host)
  finish()
  await flush()
  assert.equal(h.render(false).state.hosts.length, 0)
})

test('retry cancels the old browse and only the new attempt may publish', async () => {
  const rounds = []
  const h = harness(null, (signal, found) => {
    rounds.push({ signal, found })
    return new Promise(() => {})
  })
  h.render()
  await flush()
  h.render().retry()
  h.render()
  await flush()
  assert.equal(rounds[0].signal.aborted, true)
  rounds[0].found(host)
  assert.equal(h.render().state.hosts.length, 0)
  rounds[1].found(host)
  assert.equal(h.render().state.hosts.length, 1)
  h.render(false)
})

test('a refresh removes a direct result that no longer answers', async () => {
  let round = 0
  const h = harness(null, async (_signal, found) => {
    if (++round === 1) found(host)
  })
  h.render()
  await flush()
  assert.equal(h.render().state.hosts.length, 1)
  h.refresh()
  await flush()
  assert.equal(h.render().state.hosts.length, 0)
  h.render(false)
})

test('a late native sighting merges into the verified host without changing its selection key', async () => {
  const n = native(),
    h = harness(n, async (_signal, found) => found(host))
  h.render()
  await flush()
  const key = h.render().state.hosts[0].key
  n.emit('onResult', {
    key: 'bonjour',
    txt: contract.encodeAdvert({ version: 1, hostId, name: 'Mac', scheme: 'http' }),
    address: '192.168.1.3',
    port: 7788,
  })
  const state = h.render().state
  assert.equal(state.hosts.length, 1)
  assert.equal(state.hosts[0].key, key)
  assert.equal(state.hosts[0].routes[0].url, 'http://100.99.224.30:7788')
  h.render(false)
})

test('a faster interface response does not hide another address while its refresh is still pending', async () => {
  const other = { url: 'http://192.168.1.3:7788', interfaceName: null }
  let round = 0,
    finish
  const h = harness(null, async (_signal, found) => {
    if (++round === 1) {
      found({ ...host, routes: [...host.routes, other] })
      return
    }
    found(host)
    await new Promise((resolve) => {
      finish = resolve
    })
  })
  h.render()
  await flush()
  assert.equal(h.render().state.hosts[0].routes.length, 2)
  h.refresh()
  await flush()
  assert.equal(h.render().state.hosts[0].routes.length, 2, 'retain known routes until this round finishes')
  finish()
  await flush()
  assert.equal(h.render().state.hosts[0].routes.length, 1, 'remove a route only after its completed refresh failed')
  h.render(false)
})
