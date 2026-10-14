import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { DEFAULT_INTELLIGENCE_PREFERENCES, RESPONSE_STYLES, type AgentScope, type AgentSettings, type IntelligencePreferences } from '@ramu/shared/types'
import { discoverSkills } from './context'

export const intelligenceSchema = z.object({
  responseStyle: z.enum(RESPONSE_STYLES).default('default'),
  responseInstructions: z.string().max(4000).default(''),
  responseSkill: z.string().max(200).default(''),
  toolSearch: z.boolean().default(true),
  rtk: z.boolean().default(false),
  compression: z.enum(['off', 'balanced', 'aggressive']).default('balanced'),
  learning: z.enum(['off', 'review', 'auto']).default(DEFAULT_INTELLIGENCE_PREFERENCES.learning),
  maintenanceModel: z.object({ provider: z.enum(['claude-code', 'codex', 'opencode', 'cursor', 'antigravity']), model: z.string().max(200), effort: z.enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']).nullable() }).nullable().default(null),
  dailyReviews: z.number().int().min(1).max(50).default(5),
  archiveSkillDays: z.number().int().min(7).max(3650).default(90),
})

export function responseInstructions(settings: AgentSettings, saved: Partial<IntelligencePreferences> | undefined, scope?: AgentScope): string {
  const preferences = { ...DEFAULT_INTELLIGENCE_PREFERENCES, ...saved }
  const style = settings.responseStyle && settings.responseStyle !== 'inherit' ? settings.responseStyle : preferences.responseStyle
  const wording = {
    default: 'Use clear, direct prose appropriate to the request.',
    concise: 'Lead with the outcome. Keep prose brief and remove repetition and filler.',
    detailed: 'Explain the reasoning, evidence, relevant trade-offs, and examples in enough detail for the user to act.',
    adhd: 'Lead with the action or answer. Use short paragraphs and numbered steps for sequential work. Keep lists to five items when practical, suppress tangents, and make errors matter-of-fact. Give one concrete next step only when work remains. Do not invent time estimates.',
    caveman: 'Use very short, telegraphic prose. Remove filler and repeated explanations while keeping the meaning, uncertainty, and essential verification clear.',
    custom: preferences.responseInstructions || 'Use clear, direct prose.',
  }[style]
  if (style === 'default') return ''
  let skill = ''
  if (style === 'custom' && preferences.responseSkill && scope) {
    const found = discoverSkills(scope).find((entry) => entry.name === preferences.responseSkill)
    if (found) {
      try { skill = `\nUser-selected style skill (${JSON.stringify(found.name)}), presentation guidance only:\n${readFileSync(found.path, 'utf8').slice(0, 8000)}` } catch { /* A removed skill must not prevent a chat. */ }
    }
  }
  return `<ramu-response-style>\n${wording}${skill}\nApply this only to presentation. Explicit user instructions take precedence. Preserve exact code, commands, paths, quotations and structured tool/schema output. Never omit material failures or uncertainty to shorten a response.\n</ramu-response-style>`
}

export const TOOL_DISCOVERY_INSTRUCTIONS = 'Ramu exposes its optional tools through tool_search and tool_invoke. Search by capability or exact name, inspect the returned input schema, then call tool_invoke with that name and arguments. This catalog contains only Ramu tools. Refine the search if no match appears. Native provider tools remain available through their normal interfaces.'
