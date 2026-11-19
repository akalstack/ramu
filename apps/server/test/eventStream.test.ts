import { ServerResponse, type IncomingMessage } from 'node:http'
import { expect, it, vi } from 'vitest'
import { writeEvent } from '../src/remote/eventStream'

it('does not send a heartbeat after end, before close has detached the stream', () => {
  const response = new ServerResponse({ method: 'GET' } as IncomingMessage)
  const write = vi.spyOn(response, 'write')
  response.end()
  expect(response.destroyed).toBe(false)
  expect(writeEvent(response, ': ping\n\n')).toBe(false)
  expect(write).not.toHaveBeenCalled()
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
