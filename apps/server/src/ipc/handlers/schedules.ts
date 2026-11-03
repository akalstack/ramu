import { z } from 'zod'
import type { ScheduleInput } from '@ramu/shared/types'
import { scheduleSchema, ruleSchema, previewOccurrences } from '../../background/schedules'
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
  'schedules.deliveries': { args: z.tuple([id]), run: (scheduleId: string) => schedules.deliveries(scheduleId) },
  'schedules.replay': {
    args: z.tuple([id, id]),
    run: (scheduleId: string, deliveryId: string) => schedules.replay(scheduleId, deliveryId),
  },
  'schedules.sendTest': { args: z.tuple([id]), run: (scheduleId: string) => schedules.sendTest(scheduleId) },
  'schedules.webhook': { args: z.tuple([id]), run: (scheduleId: string) => schedules.webhook(scheduleId) },
  'schedules.rotateWebhook': { args: z.tuple([id]), run: (scheduleId: string) => schedules.rotateWebhook(scheduleId) },
  'schedules.setWebhookSecret': {
    args: z.tuple([id, z.string().trim().min(8).max(500).nullable()]),
    run: (scheduleId: string, secret: string | null) => schedules.setWebhookSecret(scheduleId, secret),
  },
  'recaps.get': { args: z.tuple([]), run: () => recaps.snapshot() },
  'recaps.refresh': { args: z.tuple([]), run: () => recaps.refresh() },
  'recaps.act': {
    args: z.tuple([id, z.enum(['open', 'done', 'dismissed', 'snoozed']), z.number().int().positive().optional()]),
    run: (itemId: string, action: 'open' | 'done' | 'dismissed' | 'snoozed', until?: number) =>
      recaps.act(itemId, action, until),
  },
})
