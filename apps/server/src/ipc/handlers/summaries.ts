import { z } from 'zod'
import type { AgentSettings } from '@ramu/shared/types'
import { agentSettings, id } from '../schemas'
import { need } from '../helpers'
import type { RegisterHandlers } from '../types'

/** "What Ramu learned": the summaries, their history, and the review chats started from them. */
export const registerSummaryHandlers: RegisterHandlers = ({ agents, summaries }) => ({
  'summaries.get': { args: z.tuple([]), run: () => need(summaries).snapshot() },
  'summaries.read': { args: z.tuple([id]), run: (summaryId: string) => need(summaries).read(summaryId) },
  'summaries.dismiss': { args: z.tuple([id]), run: (summaryId: string) => need(summaries).dismiss(summaryId) },
  'summaries.run': { args: z.tuple([]), run: () => need(summaries).run(true) },
  'summaries.discuss': {
    args: z.tuple([id, z.string().max(100_000), agentSettings.optional()]),
    run: async (summaryId: string, text: string, settings?: AgentSettings) => {
      if (settings) await agents.validateSettings(settings)
      return need(summaries).discuss(summaryId, text, settings)
    },
  },
})
