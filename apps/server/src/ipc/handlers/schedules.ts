import { z } from 'zod'
import type { ScheduleInput } from '@ramu/shared/types'
import { scheduleSchema, ruleSchema, previewOccurrences } from '../../schedules'
import { id } from '../schemas'
import type { RegisterHandlers } from '../types'

/** Schedules and the daily recaps. */
export const registerScheduleHandlers: RegisterHandlers = ({ schedules, recaps }) => ({
  'schedules.list': { args: z.tuple([]), run: () => schedules.list() },
  'schedules.save': {
    args: z.tuple([scheduleSchema, id.optional()]),
    run: (input: ScheduleInput, scheduleId?: string) => schedules.save(input, scheduleId),
  },
  'schedules.pause': {
    args: z.tuple([id, z.boolean()]),
    run: (scheduleId: string, paused: boolean) => schedules.pause(scheduleId, paused),
  },
  'schedules.delete': { args: z.tuple([id]), run: (scheduleId: string) => schedules.delete(scheduleId) },
  'schedules.runNow': { args: z.tuple([id]), run: (scheduleId: string) => schedules.runNow(scheduleId) },
  'schedules.runs': { args: z.tuple([id.optional()]), run: (scheduleId?: string) => schedules.runs(scheduleId) },
  'schedules.preview': {
    args: z.tuple([ruleSchema, z.string()]),
    run: (rule: Parameters<typeof previewOccurrences>[0], zone: string) => {
      if (!scheduleSchema.shape.timezone.safeParse(zone).success) throw new Error('Unknown timezone')
      return previewOccurrences(rule, zone, Date.now())
    },
  },
  'recaps.get': { args: z.tuple([]), run: () => recaps.snapshot() },
  'recaps.refresh': { args: z.tuple([]), run: () => recaps.refresh() },
  'recaps.act': {
    args: z.tuple([id, z.enum(['open', 'done', 'dismissed', 'snoozed'])]),
    run: (itemId: string, action: 'open' | 'done' | 'dismissed' | 'snoozed') => recaps.act(itemId, action),
  },
})
