import { expect, it } from 'vitest'
import type { BackgroundTerminalInfo } from '../src/api'
import { readRemovalCommands, removalCommands, removalReview } from '../src/chat/taskRemoval'
const row = (id: string, state: BackgroundTerminalInfo['state']) => ({ id, state }) as BackgroundTerminalInfo
it('reviews live and uncertain ownership while excluding settled history', () => {
  const rows = [
    row('live', 'running'),
    row('stopping', 'stopping'),
    row('unknown', 'unknown'),
    row('done', 'exited'),
    row('failed', 'failed'),
  ]
  expect(removalCommands(rows).map((command) => command.id)).toEqual(['live', 'stopping', 'unknown'])
  expect(removalReview(rows)).toEqual({ backgroundIds: ['live', 'stopping', 'unknown'], forgetUnknown: true })
})
it('does not confuse an offline or denied host with a host lacking managed commands', async () => {
  await expect(
    readRemovalCommands(async () => {
      throw new Error('ECONNREFUSED')
    }, 'thread'),
  ).rejects.toThrow('ECONNREFUSED')
  await expect(
    readRemovalCommands(async () => {
      throw new Error('This device is a viewer')
    }, 'thread'),
  ).rejects.toThrow('viewer')
})
it('refuses a command list that belongs to another thread', async () => {
  await expect(
    readRemovalCommands(async () => [{ ...row('wrong', 'running'), taskId: 'other' }], 'thread'),
  ).rejects.toThrow(/scope changed/)
})
