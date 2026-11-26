import { expect, it, vi } from 'vitest'
import { claimSocketPath } from '../src/socketClaim'

it('refuses a socket a running service answers on, and leaves it in place', async () => {
  const remove = vi.fn()
  await expect(claimSocketPath('/tmp/ramu.sock', async () => ({ running: true }), remove)).rejects.toThrow(
    /already running on \/tmp\/ramu\.sock.*RAMU_SOCKET/,
  )
  expect(remove).not.toHaveBeenCalled()
})

it('clears a socket left by a service that exited', async () => {
  const remove = vi.fn()
  const gone = async () => {
    throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
  }
  await claimSocketPath('/tmp/ramu.sock', gone, remove)
  expect(remove).toHaveBeenCalledWith('/tmp/ramu.sock')
})

it('starts where no socket exists yet', async () => {
  const gone = async () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  }
  const remove = () => {
    throw Object.assign(new Error('missing'), { code: 'ENOENT' })
  }
  await expect(claimSocketPath('/tmp/ramu.sock', gone, remove)).resolves.toBeUndefined()
})

it('waits out a service that is finishing its shutdown', async () => {
  const remove = vi.fn()
  let asked = 0
  const stopping = async () => {
    if (++asked < 3) return { running: true }
    throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })
  }
  await claimSocketPath('/tmp/ramu.sock', stopping, remove, { tries: 5, pauseMs: 1 })
  expect(asked).toBe(3)
  expect(remove).toHaveBeenCalledOnce()
})
