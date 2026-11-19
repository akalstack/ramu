import { test } from 'node:test'
import assert from 'node:assert/strict'
import { devAddresses, devEnvironment, publishesLocalAddresses } from '../scripts/dev-addresses.mjs'
const entry = (address, internal = false) => ({ address, family: 'IPv4', internal })

test('Metro prefers NetBird/Tailscale over Wi-Fi and container networks', () => {
  const interfaces = {
    bridge100: [entry('192.168.139.3')],
    en0: [entry('192.168.1.3')],
    utun100: [entry('100.99.224.30')],
    lo0: [entry('127.0.0.1', true)],
  }
  assert.deepEqual(devAddresses(interfaces), ['100.99.224.30', '192.168.1.3', '192.168.139.3'])
  delete interfaces.utun100
  assert.equal(devAddresses(interfaces)[0], '192.168.1.3')
  assert.equal(devAddresses({ tailscale0: [entry('100.64.0.1')] })[0], '100.64.0.1')
  assert.deepEqual(devAddresses({ en0: [entry('100.128.0.1'), entry('169.254.0.1')] }), [])
})

test('explicit host, proxy, localhost and tunnel choices survive automatic selection', () => {
  const addresses = ['100.99.224.30']
  assert.deepEqual(devEnvironment({}, [], addresses), { EXPO_UNSTABLE_BONJOUR: '1' })
  assert.equal(publishesLocalAddresses({}, []), true)
  assert.deepEqual(devEnvironment({ EXPO_UNSTABLE_BONJOUR: '0' }, [], addresses), { EXPO_UNSTABLE_BONJOUR: '0' })
  for (const env of [
    { REACT_NATIVE_PACKAGER_HOSTNAME: '192.168.1.3' },
    { EXPO_PACKAGER_PROXY_URL: 'https://metro.example' },
  ]) {
    assert.deepEqual(devEnvironment(env, [], addresses), env)
    assert.equal(publishesLocalAddresses(env, []), false)
  }
  for (const args of [['--tunnel'], ['--localhost'], ['--host', 'localhost'], ['--host=localhost']])
    assert.deepEqual(devEnvironment({}, args, addresses), {})
  assert.deepEqual(devEnvironment({}, [], []), {})
})
