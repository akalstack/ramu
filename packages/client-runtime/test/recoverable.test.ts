import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { isTransportFailure, runtimeInvokeRecoverable } from '../src'

let server: Server | undefined
afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())))

async function host(options: { operationKeys: boolean; dropFirst?: number }) {
  const seen: { method: string; key?: string }[] = []
  let drops = options.dropFirst ?? 0
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const { method, operationKey } = JSON.parse(Buffer.concat(chunks).toString())
      if (method === 'background.status') {
        res.end(JSON.stringify({ value: { capabilities: options.operationKeys ? ['operation-keys'] : [] } }))
        return
      }
      seen.push({ method, key: operationKey })
      if (drops-- > 0) return void req.socket.destroy()
      res.end(JSON.stringify({ value: seen.length }))
    })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return { target: { kind: 'http' as const, url: `http://127.0.0.1:${port}`, token: 't' }, seen }
}

describe('runtimeInvokeRecoverable', () => {
  it('retries a lost connection under one operation key', async () => {
    const { target, seen } = await host({ operationKeys: true, dropFirst: 1 })
    const result = await runtimeInvokeRecoverable(target, 'agent.send', ['s', 'hi'], {
      backoffMs: 1,
      newKey: () => 'k1',
    })
    expect(result).toBe(2)
    expect(seen.map((entry) => entry.key)).toEqual(['k1', 'k1'])
  })

  it('does not retry on a host without operation keys, and sends no key', async () => {
    const { target, seen } = await host({ operationKeys: false, dropFirst: 1 })
    await expect(runtimeInvokeRecoverable(target, 'agent.send', ['s', 'hi'], { backoffMs: 1 })).rejects.toThrow()
    expect(seen).toEqual([{ method: 'agent.send', key: undefined }])
  })

  it('leaves unlisted methods alone', async () => {
    const { target, seen } = await host({ operationKeys: true, dropFirst: 1 })
    await expect(runtimeInvokeRecoverable(target, 'tasks.list', [], { backoffMs: 1 })).rejects.toThrow()
    expect(seen).toEqual([{ method: 'tasks.list', key: undefined }])
  })

  it('gives up after the bounded retries', async () => {
    const { target, seen } = await host({ operationKeys: true, dropFirst: 5 })
    await expect(runtimeInvokeRecoverable(target, 'tasks.create', [{}], { backoffMs: 1, retries: 2 })).rejects.toThrow()
    expect(seen).toHaveLength(3)
  })
})

describe('isTransportFailure', () => {
  it('treats host answers as final and connection loss as retryable', () => {
    expect(isTransportFailure(new Error('Unknown method'))).toBe(false)
    expect(isTransportFailure(new Error('Background service request timed out'))).toBe(true)
    expect(isTransportFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isTransportFailure(new SyntaxError('Unexpected end of JSON input'))).toBe(true)
  })
})
