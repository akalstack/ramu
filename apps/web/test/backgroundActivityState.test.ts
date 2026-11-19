import { expect, it } from 'vitest'
import { readBackgroundActivity } from '../src/chat/backgroundActivityState'

it('keeps a healthy older service connected when the activity endpoint is missing', async () => {
  const state = await readBackgroundActivity(
    async () => {
      throw new Error('Unknown method activity.status')
    },
    async () => ({ running: true }),
  )
  expect(state).toEqual({ activities: [], connected: true })
})

it('shows reconnecting when both activity and service requests fail', async () => {
  const offline = async (): Promise<never> => {
    throw new Error('ECONNREFUSED')
  }
  expect(await readBackgroundActivity(offline, offline)).toEqual({ activities: [], connected: false })
})

it('recovers activity when the service supports it', async () => {
  const activities = [{ id: 'cli', label: 'Updating CLI' }]
  expect(
    await readBackgroundActivity(
      async () => activities,
      async () => ({ running: false }),
    ),
  ).toEqual({ activities, connected: true })
})
