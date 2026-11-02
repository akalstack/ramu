import { expect, it, vi } from 'vitest'
import { ResourceService } from '../src/background/resources'
import { viewerMayInvoke } from '@ramu/shared/viewerAccess'
import { HOST_METHODS } from '../src/remote/access'

const gb = 1024 ** 3
const sources = (idle: string[] = []) => ({ roots: () => [], idleThreads: () => new Set(idle) })

it('shares one read between callers and skips ps until someone looks', async () => {
  const table = vi.fn(async () => [])
  const service = new ResourceService(sources(), async () => null, table)
  await service.check()
  expect(table).not.toHaveBeenCalled()
  await Promise.all([service.snapshot(), service.snapshot()])
  await service.snapshot()
  expect(table).toHaveBeenCalledTimes(1)
})

it('calls a host low only after two checks, and clears on recovery', async () => {
  let availableBytes = 0.5 * gb
  const service = new ResourceService(
    sources(),
    async () => ({ totalBytes: 16 * gb, availableBytes }),
    async () => [],
  )
  await service.check()
  expect(service.host().low).toBeNull()
  await service.check()
  expect(service.host().low).toMatchObject({ availableBytes: 0.5 * gb, idleThreads: [] })
  availableBytes = 8 * gb
  await service.check()
  expect(service.host().low).toBeNull()
})

it('keeps process figures from viewers and paired hosts', () => {
  expect(viewerMayInvoke('resources.snapshot')).toBe(false)
  expect(viewerMayInvoke('resources.host')).toBe(false)
  expect(HOST_METHODS.has('resources.snapshot')).toBe(false)
})
