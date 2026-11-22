import { afterEach, describe, expect, it } from 'vitest'
import { closeHostSockets, isTransportFailure, runtimeInvokeRecoverable } from '../src'
import { DROP, socketHost } from './support/socketHost'

let stop: (() => Promise<void>) | undefined
afterEach(async () => {
  closeHostSockets()
  await stop?.()
  stop = undefined
})

async function host(options: { dropFirst?: number }) {
  let drops = options.dropFirst ?? 0
  const running = await socketHost({
    token: 't',
    answer: () => {
      // agent.send answers nothing.
      return drops-- > 0 ? DROP : null
    },
  })
  stop = running.close
  const seen = () => running.calls.map((call) => ({ method: call.method, key: call.operationKey }))
  return { target: running.endpoint, seen }
}

describe('runtimeInvokeRecoverable', () => {
  it('retries a lost connection under one operation key', async () => {
    const { target, seen } = await host({ dropFirst: 1 })
    const result = await runtimeInvokeRecoverable(target, 'agent.send', ['s', 'hi'], {
      backoffMs: 1,
      newKey: () => 'operation-key-1',
    })
    expect(result).toBeNull()
    expect(seen().map((entry) => entry.key)).toEqual(['operation-key-1', 'operation-key-1'])
  })

  it('leaves unlisted methods alone', async () => {
    const { target, seen } = await host({ dropFirst: 1 })
    await expect(runtimeInvokeRecoverable(target, 'tasks.list', [], { backoffMs: 1 })).rejects.toThrow()
    expect(seen()).toEqual([{ method: 'tasks.list', key: undefined }])
  })

  it('gives up after the bounded retries', async () => {
    const { target, seen } = await host({ dropFirst: 5 })
    await expect(runtimeInvokeRecoverable(target, 'tasks.create', [{}], { backoffMs: 1, retries: 2 })).rejects.toThrow()
    expect(seen()).toHaveLength(3)
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
