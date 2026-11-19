import type { AgentProvider, AgentSettings } from '@ramu/shared/types'

/** Providers whose chats always record their account; the others record it only when it is not the default login. */
export const RECORDED_ACCOUNT_PROVIDERS: ReadonlySet<AgentProvider> = new Set(['codex', 'opencode'])

/** Claude's permission mode for a chat's access setting, outside plan mode. */
export function baseMode(settings: AgentSettings): 'bypassPermissions' | 'acceptEdits' | 'auto' {
  return settings.access === 'full' ? 'bypassPermissions' : settings.access === 'edits' ? 'acceptEdits' : 'auto'
}

/** The SDK lists a model's effort levels but not which one it uses by default. Medium is Claude Code's own default. */
export function claudeDefaultEffort<T extends string>(efforts: readonly T[]): T | null {
  return efforts.find((effort) => effort === 'medium') ?? efforts[Math.floor((efforts.length - 1) / 2)] ?? null
}

/** Settings are equal when every field matches once defaults are filled in; key order and omitted defaults don't count. */
export function sameSettings(a: AgentSettings, b: AgentSettings): boolean {
  const norm = (s: AgentSettings) =>
    JSON.stringify([
      s.provider,
      s.accountId ?? 'default',
      s.model,
      s.effort ?? null,
      s.serviceTier ?? 'standard',
      s.access,
      s.autoFallback,
    ])
  return norm(a) === norm(b)
}
