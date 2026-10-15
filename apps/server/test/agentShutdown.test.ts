import { expect, it, vi } from 'vitest'
import { openDb } from '../src/db'
import { AgentService } from '../src/agent'
import { fakeQuery } from '../src/providers/fakeAgent'
import type { AgentSessionInfo } from '@ramu/shared/types'

it('pending and late steering callbacks do not access the database after shutdown', async () => {
  const db = openDb(':memory:')
  const service = new AgentService(db, () => {}, fakeQuery)
  const get = vi.spyOn(service, 'get').mockReturnValue({ state: 'running' } as AgentSessionInfo)
  const events = vi.spyOn(service, 'events').mockReturnValue([])
  const steering = service as unknown as {
    dispatchSteering(id: string): Promise<void>
    dispatchQueued(id: string): Promise<void>
  }
  const pending = steering.dispatchSteering('chat')
  service.stopAll()
  db.close()
  get.mockImplementation(() => {
    throw new Error('Database access after shutdown')
  })
  events.mockImplementation(() => {
    throw new Error('Database access after shutdown')
  })
  await expect(pending).resolves.toBeUndefined()
  await expect(steering.dispatchSteering('late')).resolves.toBeUndefined()
  await expect(steering.dispatchQueued('late')).resolves.toBeUndefined()
})
