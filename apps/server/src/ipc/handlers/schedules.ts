import { z } from 'zod'
import type { ScheduleInput } from '@ramu/shared/types'
import { scheduleSchema, ruleSchema, previewOccurrences } from '../../background/schedules'
import { WebhookSetup } from '../../background/webhookSetup'
import { id } from '../schemas'
import { cursorArg, limitArg } from '../../paging'
import type { RegisterHandlers } from '../types'

/** Schedules. */
export const registerScheduleHandlers: RegisterHandlers = ({ schedules, workspace }) => {
  const setup = new WebhookSetup(schedules, workspace)
  return {
    'schedules.list': { args: z.tuple([]), run: () => schedules.list() },
    'schedules.save': {
      args: z.tuple([scheduleSchema, id.optional()]),
      run: async (input: ScheduleInput, scheduleId?: string) => {
        const saved = schedules.save(input, scheduleId)
        // An edit can change which events matter; a repository webhook Ramu made follows it.
        if (scheduleId) await setup.refresh(saved.id).catch(() => {})
        return schedules.get(saved.id)
      },
    },
    'schedules.pause': {
      args: z.tuple([id, z.boolean()]),
      run: (scheduleId: string, paused: boolean) => schedules.pause(scheduleId, paused),
    },
    'schedules.delete': {
      args: z.tuple([id]),
      run: async (scheduleId: string) => {
        await setup.beforeDelete(scheduleId)
        schedules.delete(scheduleId)
      },
    },
    'schedules.runNow': { args: z.tuple([id]), run: (scheduleId: string) => schedules.runNow(scheduleId) },
    'schedules.runs': { args: z.tuple([id.optional()]), run: (scheduleId?: string) => schedules.runs(scheduleId) },
    'schedules.runsPage': {
      args: z.tuple([id, cursorArg, limitArg]),
      run: (scheduleId: string, cursor: string | null, limit: number) => schedules.runsPage(scheduleId, cursor, limit),
    },
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
    'schedules.rotateWebhook': {
      args: z.tuple([id]),
      run: async (scheduleId: string) => {
        schedules.rotateWebhook(scheduleId)
        await setup.refresh(scheduleId)
        return schedules.get(scheduleId)
      },
    },
    'schedules.githubRepos': { args: z.tuple([id]), run: (scheduleId: string) => setup.githubRepos(scheduleId) },
    'schedules.connectGithub': {
      args: z.tuple([id, id]),
      run: (scheduleId: string, repoId: string) => setup.connectGithub(scheduleId, repoId),
    },
    'schedules.setWebhookSecret': {
      args: z.tuple([id, z.string().trim().min(8).max(500).nullable()]),
      run: (scheduleId: string, secret: string | null) => schedules.setWebhookSecret(scheduleId, secret),
    },
    // Apps released with daily recaps still ask for them on every overview; an empty answer keeps theirs working.
    'recaps.get': {
      args: z.tuple([]),
      run: () => ({ items: [], generatedAt: null, generating: false as const, error: null }),
    },
  }
}
