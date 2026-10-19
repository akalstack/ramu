import { z } from 'zod'
import { DEFAULT_INTELLIGENCE_PREFERENCES } from '@ramu/shared/types'

export const intelligenceSchema = z.object({
  toolSearch: z.boolean().default(true),
  crossThreadRecall: z.boolean().default(DEFAULT_INTELLIGENCE_PREFERENCES.crossThreadRecall),
  learning: z.enum(['off', 'review', 'auto']).default(DEFAULT_INTELLIGENCE_PREFERENCES.learning),
  maintenanceModel: z
    .object({
      provider: z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']),
      model: z.string().max(200),
      effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable(),
    })
    .nullable()
    .default(null),
  dailyReviews: z.number().int().min(1).max(50).default(5),
  archiveSkillDays: z.number().int().min(7).max(3650).default(90),
  summaryInterval: z.enum(['off', 'daily', 'weekly']).default(DEFAULT_INTELLIGENCE_PREFERENCES.summaryInterval),
  summaryMemory: z.boolean().default(true),
  summarySkills: z.boolean().default(true),
  summaryOnHome: z.boolean().default(true),
})

export const TOOL_DISCOVERY_INSTRUCTIONS =
  'Ramu exposes its optional tools through tool_search and tool_invoke. Search by capability or exact name, inspect the returned input schema, then call tool_invoke with that name and arguments. This catalog contains only Ramu tools. Refine the search if no match appears. Native provider tools remain available through their normal interfaces.'
