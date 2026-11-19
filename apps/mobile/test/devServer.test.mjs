import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { devPort, withDevPort, devLaunchLinks } from '../scripts/dev-server.mjs'

test('launch links cover every interface and keep the address in the native launch target', () => {
  const addresses = ['192.168.1.3', '100.99.224.30', 'fd00::1']
  const links = devLaunchLinks(addresses, 8090, 'exp+ramu')
  assert.deepEqual(
    links.map((link) => new URL(link).searchParams.get('__expo_url')),
    ['http://192.168.1.3:8090', 'http://100.99.224.30:8090', 'http://[fd00::1]:8090'],
  )
  assert.deepEqual(devLaunchLinks(['100.99.224.30'], 8082, 'exp'), ['exp://100.99.224.30:8082'])
  assert.ok(devLaunchLinks(['192.168.1.3'], 8081, 'custom-dev')[0].startsWith('custom-dev://'))
})

test('a busy default port moves all links together; an explicit busy port reports the conflict', async () => {
  const occupied = createServer()
  await new Promise((resolve) => occupied.listen(0, resolve))
  try {
    const port = occupied.address().port
    assert.notEqual(await devPort([], { RCT_METRO_PORT: String(port) }), port)
    await assert.rejects(devPort(['--port', String(port)], {}), /busy/)
    await assert.rejects(devPort(['--port=' + port], {}), /busy/)
  } finally {
    await new Promise((resolve) => occupied.close(resolve))
  }
})

test('the selected port reaches Expo without duplicate or stale port arguments', () => {
  assert.deepEqual(withDevPort(['--go', '--port', '8081', '--clear'], 8082), ['--go', '--clear', '--port', '8082'])
  assert.deepEqual(withDevPort(['--dev-client', '--port=8081'], 8082), ['--dev-client', '--port', '8082'])
})

test('invalid explicit ports fail before publishing unusable links', async () => {
  for (const port of ['0', '-1', '65536', 'not-a-port'])
    await assert.rejects(devPort(['--port', port], {}), /between 1 and 65535/)
})
