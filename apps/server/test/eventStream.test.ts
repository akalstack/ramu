import { createServer, ServerResponse, type IncomingMessage } from 'node:http'
import { request } from 'node:http'
import type { AddressInfo } from 'node:net'
import { expect, it, vi } from 'vitest'
import { watchEventStream, writeEvent } from '../src/remote/eventStream'

it('does not send a heartbeat after end, before close has detached the stream', () => {
  const response = new ServerResponse({ method: 'GET' } as IncomingMessage)
  const write = vi.spyOn(response, 'write')
  response.end()
  expect(response.destroyed).toBe(false)
  expect(writeEvent(response, ': ping\n\n')).toBe(false)
  expect(write).not.toHaveBeenCalled()
})

it('detaches once and absorbs asynchronous response errors without taking down other streams', () => {
  const response = new ServerResponse({ method: 'GET' } as IncomingMessage)
  const detach = vi.fn()
  watchEventStream(response, detach)
  response.emit('error', new Error('write after end'))
  response.emit('close')
  response.emit('error', new Error('socket closed'))
  expect(detach).toHaveBeenCalledTimes(1)
  expect(response.destroyed).toBe(true)
  expect(writeEvent(response, ': ping\n\n')).toBe(false)
  const healthy = { destroyed: false, writableLength: 1, write: vi.fn(() => false), destroy: vi.fn(), end: vi.fn() }
  expect(writeEvent(healthy, 'data: alive\n\n')).toBe(true)
  expect(healthy.destroy).not.toHaveBeenCalled()
})

it('a failed transport write is contained', () => {
  const sink = {
    destroyed: false,
    writableLength: 0,
    write() {
      throw new Error('closed')
    },
    destroy: vi.fn(),
    end: vi.fn(),
  }
  expect(writeEvent(sink, ': ping\n\n')).toBe(false)
  expect(sink.destroy).toHaveBeenCalledOnce()
})

it('removes an ended SSE response on finish and leaves the server available', async () => {
  const clients = new Set<ServerResponse>()
  const detached = vi.fn()
  const server = createServer((_req, response) => {
    clients.add(response)
    watchEventStream(response, () => {
      clients.delete(response)
      detached()
    })
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    writeEvent(response, ': connected\n\n')
    response.end()
    expect(writeEvent(response, ': ping\n\n')).toBe(false)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const port = (server.address() as AddressInfo).port
    for (let i = 0; i < 2; i++)
      await new Promise<void>((resolve, reject) => {
        const req = request({ hostname: '127.0.0.1', port }, (response) => {
          response.resume()
          response.once('end', resolve)
          response.once('error', reject)
        })
        req.once('error', reject)
        req.end()
      })
    expect(clients.size).toBe(0)
    expect(detached).toHaveBeenCalledTimes(2)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})
