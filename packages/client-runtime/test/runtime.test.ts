import { afterEach, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PROTOCOL_HEADER, PROTOCOL_VERSION, decodeInvoke } from '@ramu/contracts'
import { runtimeInvoke, runtimeSocket, subscribeRuntime } from '../src'

const servers: Server[] = [], dirs: string[] = []
afterEach(() => { servers.forEach((server) => server.close()); servers.length = 0; dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })); dirs.length = 0 })

async function listen(handler: Parameters<typeof createServer>[1], target: number | string) {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(target as never, resolve))
  return server
}
const echoFor = (token: string | null): Parameters<typeof createServer>[1] => async (req, res) => {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk)
  const { method, args } = decodeInvoke(Buffer.concat(chunks).toString())
  if (token && req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401).end(); return }
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(method === 'fail' ? { error: 'nope' } : { value: { method, args: args.length, first: args[0] === undefined, protocol: req.headers[PROTOCOL_HEADER] } }))
}

it('derives a short, stable socket path per profile', () => {
  expect(runtimeSocket('/a')).toBe(runtimeSocket('/a'))
  expect(runtimeSocket('/a')).not.toBe(runtimeSocket('/b'))
  expect(runtimeSocket('/a'.repeat(200)).length).toBeLessThan(100)
})

it('invokes over a unix socket with the protocol header', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ramu-rt-')); dirs.push(dir)
  const path = join(dir, 's.sock')
  await listen(echoFor(null), path)
  const value = await runtimeInvoke(path, 'x.y', [undefined, 1])
  expect(value).toEqual({ method: 'x.y', args: 2, first: true, protocol: String(PROTOCOL_VERSION) })
})

it('authenticates over HTTP and surfaces server errors', async () => {
  const server = await listen(echoFor('secret'), 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  expect((await runtimeInvoke({ kind: 'http', url, token: 'secret' }, 'ok')).method).toBe('ok')
  await expect(runtimeInvoke({ kind: 'http', url, token: 'secret' }, 'fail')).rejects.toThrow('nope')
  await expect(runtimeInvoke({ kind: 'http', url, token: 'wrong' }, 'ok')).rejects.toThrow(/access token/)
})

it('streams events and reports connection state', async () => {
  const server = await listen((req, res) => {
    if (req.headers.authorization !== 'Bearer secret') { res.writeHead(401).end(); return }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' })
    res.write(': connected\n\n')
    res.write(`data: ${JSON.stringify({ channel: 'automation:changed', payload: {} })}\n\n`)
  }, 0)
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const seen: string[] = []
  const stop = subscribeRuntime({ kind: 'http', url, token: 'secret' }, (channel) => seen.push(channel))
  await expect.poll(() => seen).toEqual(['background:connection', 'automation:changed'])
  stop()
})
