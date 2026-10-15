import { z } from 'zod'
import type { BackgroundActivity } from '@ramu/shared/activity'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** Background work the app reports on: activity, app updates, keep-awake and notices. */
export const registerBackgroundHandlers: RegisterHandlers = ({
  activity,
  updates,
  awake,
  memory,
  learning,
  recaps,
  notices,
}) => ({
  'background.keepAwake': { args: z.tuple([]), run: () => awake.status() },
  'activity.status': {
    args: z.tuple([]),
    run: () => {
      const items: BackgroundActivity[] = activity.status()
      const phase = updates.status().phase
      if (phase === 'checking' || phase === 'downloading')
        items.push({
          id: 'app-update',
          label: phase === 'checking' ? 'Checking app updates' : 'Downloading app update',
          cancellable: true,
        })
      if (memory?.snapshot().dreaming) items.push({ id: 'memory', label: 'Maintaining memories', cancellable: true })
      if (learning?.snapshot().running) items.push({ id: 'learning', label: 'Learning skills', cancellable: true })
      if (recaps.snapshot().generating) items.push({ id: 'recaps', label: 'Generating recaps', cancellable: true })
      return items
    },
  },
  'activity.cancel': {
    args: z.tuple([id]),
    run: async (activityId: string) => {
      // Cancel only work whose owner supports it; never kill a service or an arbitrary Git/package operation.
      if (activityId === 'app-update') await updates.cancel()
      else if (activityId === 'memory') memory?.cancel()
      else if (activityId === 'learning') learning?.cancel()
      else if (activityId === 'recaps') recaps.cancel()
      else throw new Error('This background activity cannot be stopped.')
    },
  },
  'updates.status': { args: z.tuple([]), run: () => updates.status() },
  'updates.check': { args: z.tuple([]), run: () => updates.check() },
  'updates.download': { args: z.tuple([]), run: () => updates.download() },
  'notices.list': { args: z.tuple([]), run: () => notices?.list() ?? [] },
  'notices.dismiss': { args: z.tuple([z.string().max(300)]), run: (id: string) => notices?.dismiss(id) },
  'notices.clear': { args: z.tuple([]), run: () => notices?.clear() },
})
