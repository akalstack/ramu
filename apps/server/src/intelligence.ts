import { z } from 'zod'
import { DEFAULT_INTELLIGENCE_PREFERENCES } from '@ramu/shared/types'
import { workModelChoice } from './ipc/schemas'

export const intelligenceSchema = z.object({
  toolSearch: z.boolean().default(true),
  crossThreadRecall: z.boolean().default(DEFAULT_INTELLIGENCE_PREFERENCES.crossThreadRecall),
  learning: z.enum(['off', 'review', 'auto']).default(DEFAULT_INTELLIGENCE_PREFERENCES.learning),
  maintenanceModel: workModelChoice.default(null),
  dailyReviews: z.number().int().min(1).max(50).default(5),
  archiveSkillDays: z.number().int().min(7).max(3650).default(90),
  summaryInterval: z.enum(['off', 'daily', 'weekly']).default(DEFAULT_INTELLIGENCE_PREFERENCES.summaryInterval),
  summaryMemory: z.boolean().default(true),
  summarySkills: z.boolean().default(true),
})

export const NATIVE_TOOL_DISCOVERY_INSTRUCTIONS =
  'Ramu adds tools on its ramu MCP server (memory, schedules, artifacts, the browser and more) that load on demand through your own tool search. Search for a capability before saying it is missing.'

export const TOOL_DISCOVERY_INSTRUCTIONS =
  'Ramu exposes its optional tools through tool_search and tool_invoke. Search by capability or exact name, inspect the returned input schema, then call tool_invoke with that name and arguments. This catalog contains only Ramu tools. Refine the search if no match appears. Native provider tools remain available through their normal interfaces.'
